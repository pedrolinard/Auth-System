import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieAtualizacao, removerCookieAtualizacao } from "@/lib/cookies";
import { hashToken } from "@/lib/token";

export async function DELETE(
  req: Request,
  { params }: RouteContext<"/api/auth/sessoes/[id]">,
) {
  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const { id } = await params;

  const sessao = await prisma.tokenAtualizacao.findUnique({ where: { id } });
  if (!sessao || sessao.usuarioId !== payload.sub) {
    return NextResponse.json(
      { erro: "Sessão não encontrada." },
      { status: 404 },
    );
  }

  if (!sessao.revogadoEm) {
    await prisma.tokenAtualizacao.update({
      where: { id },
      data: { revogadoEm: new Date() },
    });
  }

  const cookieAtual = await obterCookieAtualizacao();
  if (cookieAtual && hashToken(cookieAtual) === sessao.tokenHash) {
    await removerCookieAtualizacao();
  }

  return NextResponse.json({ sucesso: true });
}
