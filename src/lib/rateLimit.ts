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

// Reaproveita LogAuditoria (já existe) em vez de uma tabela dedicada — conta
// quantos eventos de um tipo vieram do mesmo IP dentro da janela de tempo.
// Sem IP (ex.: alguns ambientes de teste) não dá pra limitar por IP, então
// deixa passar em vez de bloquear todo mundo por engano.
export async function contarEventosPorIp({
  ip,
  evento,
  janelaMs,
}: {
  ip: string | null;
  evento: string;
  janelaMs: number;
}): Promise<number> {
  if (!ip) return 0;

  const desde = new Date(Date.now() - janelaMs);
  return prisma.logAuditoria.count({
    where: { evento, ip, criadoEm: { gte: desde } },
  });
}

export async function limiteExcedido({
  ip,
  evento,
  maximo,
  janelaMs,
}: {
  ip: string | null;
  evento: string;
  maximo: number;
  janelaMs: number;
}): Promise<boolean> {
  return (await contarEventosPorIp({ ip, evento, janelaMs })) >= maximo;
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
  janelaMs,
}: {
  email: string;
  evento: string;
  maximo: number;
  janelaMs: number;
}): Promise<boolean> {
  const desde = new Date(Date.now() - janelaMs);
  const contagem = await prisma.logAuditoria.count({
    where: { evento, email, criadoEm: { gte: desde } },
  });

  return contagem >= maximo;
}
