import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieAtualizacao } from "@/lib/cookies";
import { hashToken } from "@/lib/token";

export async function GET(req: Request) {
  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const cookieAtual = await obterCookieAtualizacao();
  const hashAtual = cookieAtual ? hashToken(cookieAtual) : null;

  const tokens = await prisma.tokenAtualizacao.findMany({
    where: {
      usuarioId: payload.sub,
      revogadoEm: null,
      expiraEm: { gt: new Date() },
    },
    orderBy: { criadoEm: "desc" },
    select: { id: true, tokenHash: true, criadoEm: true, expiraEm: true },
  });

  const sessoes = tokens.map(({ id, tokenHash, criadoEm, expiraEm }) => ({
    id,
    criadoEm,
    expiraEm,
    atual: tokenHash === hashAtual,
  }));

  return NextResponse.json({ sessoes });
}
