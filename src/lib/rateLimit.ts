import "server-only";

import { prisma } from "@/lib/db";

// Atenção: X-Forwarded-For é confiável apenas atrás de um proxy que o
// define/sobrescreve de verdade (Vercel faz isso em produção). Sem um proxy
// confiável na frente, um cliente pode forjar esse header pra burlar o
// limite (girando valores) ou pra derrubar outra pessoa nele (usando o IP
// real de outra pessoa) — trade-off padrão desse tipo de rate limit,
// documentado aqui em vez de escondido.
export function obterIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
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
