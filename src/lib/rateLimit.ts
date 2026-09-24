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
//
// Antes dos três, o IP do usuário final DECLARADO pelo backend de uma
// aplicação cliente (header x-usuario-ip), mas só depois que o client secret
// da requisição conferiu — ver aceitarIpDoUsuarioFinal em aplicacao.ts. Numa
// integração servidor-a-servidor todo usuário chega com o IP do backend do
// cliente; sem isso, poucas falhas somadas bloqueavam ou pediam captcha pra
// todos os usuários daquela aplicação.
const ipsDeclarados = new WeakMap<Request, string>();

export function registrarIpDeclarado(req: Request, ip: string) {
  ipsDeclarados.set(req, ip);
}

export function obterIp(req: Request): string | null {
  return (
    ipsDeclarados.get(req) ||
    req.headers.get("x-vercel-forwarded-for")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null
  );
}

// O contador por IP fica GLOBAL de propósito, sem aplicação na chave: um IP é
// um IP, não pertence a nenhum cliente, e este limite existe como rede de
// segurança do provedor contra varredura maciça — escopá-lo por aplicação
// daria a um atacante uma cota nova a cada cliente que ele conhecesse. O
// preço é que dois clientes atrás do mesmo NAT dividem contador; como o
// limite por IP é generoso de propósito (ver MAX_TENTATIVAS_LOGIN) e quem
// segura a linha de verdade é o limite por CONTA, que já é por aplicação, o
// trade-off fica do lado seguro.
function chaveIp(evento: string, ip: string): string {
  return `ip:${evento}:${ip}`;
}

// A aplicação entra na chave porque o e-mail deixou de ser único no sistema:
// sem ela, dois clientes diferentes com o mesmo endereço compartilham o mesmo
// contador, e um consegue trancar o usuário do outro só martelando o e-mail.
// É isolamento entre tenants, não afinação de limite.
function chaveEmail(evento: string, aplicacaoId: string, email: string): string {
  return `email:${evento}:${aplicacaoId}:${email}`;
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
// só. Devolve a contagem JÁ incrementada, lida da mesma operação (RETURNING):
// uma leitura separada depois veria incrementos de pedidos concorrentes.
async function incrementar(chave: string, janelaMs: number): Promise<number> {
  const expiraEm = new Date(Date.now() + janelaMs);
  const [linha] = await prisma.$queryRaw<{ contagem: number }[]>`
    INSERT INTO "limites_taxa" AS lt (chave, contagem, "expiraEm")
    VALUES (${chave}, 1, ${expiraEm})
    ON CONFLICT (chave) DO UPDATE SET
      contagem = CASE WHEN lt."expiraEm" < now() THEN 1 ELSE lt.contagem + 1 END,
      "expiraEm" = CASE WHEN lt."expiraEm" < now() THEN excluded."expiraEm" ELSE lt."expiraEm" END
    RETURNING contagem
  `;
  return Number(linha.contagem);
}

// Desfaz um incremento ainda dentro da janela. Numa janela que já virou, não
// mexe: o incremento a desfazer era da janela anterior.
async function decrementar(chave: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "limites_taxa" SET contagem = GREATEST(contagem - 1, 0)
    WHERE chave = ${chave} AND "expiraEm" >= now()
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
  aplicacaoId,
  email,
  evento,
  maximo,
}: {
  aplicacaoId: string;
  email: string;
  evento: string;
  maximo: number;
}): Promise<boolean> {
  return (await contar(chaveEmail(evento, aplicacaoId, email))) >= maximo;
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

/**
 * Consome uma unidade de uma cota genérica (ex.: e-mails por aplicação por
 * hora) e diz se ainda estava dentro dela. Incrementa ANTES de conferir: duas
 * chamadas simultâneas na última vaga não passam as duas.
 */
export async function consumirCota({
  chave,
  maximo,
  janelaMs,
}: {
  chave: string;
  maximo: number;
  janelaMs: number;
}): Promise<boolean> {
  return (await incrementar(chave, janelaMs)) <= maximo;
}

export type LimiteTentativa =
  | { ip: string | null; evento: string; maximo: number; janelaMs: number }
  | { aplicacaoId: string; email: string; evento: string; maximo: number; janelaMs: number };

export type ReservaTentativas = { liberar: () => Promise<void> };

/**
 * Reserva uma tentativa em cada limite ANTES de conferir a credencial (senha,
 * código TOTP, código de backup). Conferir o contador e só somar depois da
 * falha deixava pedidos simultâneos passarem todos pela checagem antes de
 * qualquer um somar: com o mesmo desafio de MFA, centenas de códigos em
 * paralelo contra um limite de 10.
 *
 * Devolve null quando algum limite estourou (e desfaz as reservas desta
 * chamada). Senão, a reserva: quem chama mantém ela quando a credencial está
 * ERRADA — a reserva vira a contagem da falha — e chama liberar() quando está
 * CERTA, pra acerto não gastar o orçamento de quem erra.
 */
export async function reservarTentativas(limites: LimiteTentativa[]): Promise<ReservaTentativas | null> {
  const alvos = limites.flatMap((limite): { chave: string; maximo: number; janelaMs: number }[] => {
    const { maximo, janelaMs } = limite;
    if ("ip" in limite) {
      // Sem IP não dá pra limitar por IP (mesmo critério de contarEventosPorIp).
      return limite.ip ? [{ chave: chaveIp(limite.evento, limite.ip), maximo, janelaMs }] : [];
    }
    return [{ chave: chaveEmail(limite.evento, limite.aplicacaoId, limite.email), maximo, janelaMs }];
  });

  const contagens = await Promise.all(alvos.map(({ chave, janelaMs }) => incrementar(chave, janelaMs)));
  const reserva: ReservaTentativas = {
    liberar: async () => {
      await Promise.all(alvos.map(({ chave }) => decrementar(chave)));
    },
  };
  if (contagens.some((contagem, i) => contagem > alvos[i].maximo)) {
    await reserva.liberar();
    return null;
  }
  return reserva;
}

export async function registrarTentativaEmail({
  aplicacaoId,
  email,
  evento,
  janelaMs,
}: {
  aplicacaoId: string;
  email: string;
  evento: string;
  janelaMs: number;
}): Promise<void> {
  await incrementar(chaveEmail(evento, aplicacaoId, email), janelaMs);
}
