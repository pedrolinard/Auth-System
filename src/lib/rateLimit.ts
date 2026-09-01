import "server-only";

import { prisma } from "@/lib/db";

// Ordem de confiança dos headers de IP:
//
// 1. `x-vercel-forwarded-for` / `x-real-ip` — injetados pela Vercel com o IP
//    real que a edge network resolveu. O cliente NÃO consegue forjá-los: a
//    Vercel sobrescreve qualquer valor que venha na requisição.
// 2. `x-forwarded-for` (item mais à esquerda) — só como fallback pra proxies
//    não-Vercel e pro `next dev` local. Na Vercel esse header é
//    `<valor que o cliente mandou>, <ip real>`: a Vercel ANEXA o IP real em
//    vez de substituir, então o item à esquerda é controlado pelo cliente e
//    daria pra girar valores (furar o limite) ou plantar o IP de outra
//    pessoa (bloquear ela). Por isso ele vem por último, não primeiro.
export function obterIp(req: Request): string | null {
  return (
    req.headers.get("x-vercel-forwarded-for")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null
  );
}

function chaveIp(evento: string, ip: string): string {
  return `ip:${evento}:${ip}`;
}

function chaveEmail(evento: string, email: string): string {
  return `email:${evento}:${email}`;
}

// Upsert atômico de janela fixa — mesmo padrão do INCR+EXPIRE do Redis, só
// que em Postgres puro (sem Redis neste projeto, ver README). Uma linha por
// chave: se a janela ainda vale, incrementa; se já expirou, reseta pra 1 e
// abre uma janela nova. `INSERT ... ON CONFLICT DO UPDATE` resolve tudo numa
// única ida ao banco e serializa concorrência no nível da linha — dois
// pedidos simultâneos da mesma chave não perdem incremento um do outro,
// o que um SELECT-depois-UPDATE feito no código não garantiria sem
// transação. Precisa de SQL puro porque um upsert comum do Prisma não
// expressa "soma OU reseta dependendo do valor já gravado" em uma operação
// só.
async function incrementar(chave: string, janelaMs: number): Promise<void> {
  const expiraEm = new Date(Date.now() + janelaMs);
  await prisma.$executeRaw`
    INSERT INTO "limites_taxa" AS lt (chave, contagem, "expiraEm")
    VALUES (${chave}, 1, ${expiraEm})
    ON CONFLICT (chave) DO UPDATE SET
      contagem = CASE WHEN lt."expiraEm" < now() THEN 1 ELSE lt.contagem + 1 END,
      "expiraEm" = CASE WHEN lt."expiraEm" < now() THEN excluded."expiraEm" ELSE lt."expiraEm" END
  `;
}

async function contar(chave: string): Promise<number> {
  const linha = await prisma.limiteTaxa.findUnique({ where: { chave } });
  if (!linha) return 0;
  // Janela expirada mas a linha ainda não foi podada (job de limpeza roda
  // periodicamente, não a cada leitura) — conta como zero até o próximo
  // incrementar() resetar a linha de verdade.
  if (linha.expiraEm < new Date()) return 0;
  return linha.contagem;
}

// Lê o contador por IP de um evento (ex.: falhas de login recentes do mesmo
// IP). Sem IP (ex.: alguns ambientes de teste) não dá pra limitar por IP,
// então deixa passar em vez de bloquear todo mundo por engano.
export async function contarEventosPorIp({
  ip,
  evento,
}: {
  ip: string | null;
  evento: string;
}): Promise<number> {
  if (!ip) return 0;
  return contar(chaveIp(evento, ip));
}

export async function limiteExcedido({
  ip,
  evento,
  maximo,
}: {
  ip: string | null;
  evento: string;
  maximo: number;
}): Promise<boolean> {
  return (await contarEventosPorIp({ ip, evento })) >= maximo;
}

// Complementa o limite por IP: conta o mesmo tipo de evento pelo e-mail
// alvo (independente de IP). Um limite só por IP não pega um ataque
// distribuído (credential stuffing) mirando uma única conta a partir de
// muitos IPs diferentes — cada IP isolado fica abaixo do próprio limite,
// mas a conta-alvo acumula tentativas de todos eles.
export async function limiteExcedidoPorEmail({
  email,
  evento,
  maximo,
}: {
  email: string;
  evento: string;
  maximo: number;
}): Promise<boolean> {
  return (await contar(chaveEmail(evento, email))) >= maximo;
}

// Chamadas no mesmo ponto onde a tentativa/falha já é gravada em
// LogAuditoria (registrarEvento, em lib/auditoria.ts) — alimentam os
// contadores que a PRÓXIMA requisição vai ler em limiteExcedido/
// limiteExcedidoPorEmail/contarEventosPorIp acima. `janelaMs` é passado
// explicitamente por quem chama (a mesma constante já usada no check de
// leitura da mesma rota) em vez de um mapa evento→janela centralizado aqui:
// evita os dois valores desincronizarem quando alguém mexe só num lugar.
export async function registrarTentativaIp({
  ip,
  evento,
  janelaMs,
}: {
  ip: string | null;
  evento: string;
  janelaMs: number;
}): Promise<void> {
  if (!ip) return;
  await incrementar(chaveIp(evento, ip), janelaMs);
}

export async function registrarTentativaEmail({
  email,
  evento,
  janelaMs,
}: {
  email: string;
  evento: string;
  janelaMs: number;
}): Promise<void> {
  await incrementar(chaveEmail(evento, email), janelaMs);
}
