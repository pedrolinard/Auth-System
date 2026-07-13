import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { obterCookieAtualizacao, removerCookieAtualizacao } from "@/lib/cookies";
import { hashToken } from "@/lib/token";

export async function POST() {
  const tokenAtualizacao = await obterCookieAtualizacao();

  if (tokenAtualizacao) {
    await prisma.tokenAtualizacao.updateMany({
      where: { tokenHash: hashToken(tokenAtualizacao), revogadoEm: null },
      data: { revogadoEm: new Date() },
    });
  }

  await removerCookieAtualizacao();

  return NextResponse.json({ sucesso: true });
}
