import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autenticarRequisicao } from "@/lib/autenticar";
import {
  obterCookieAtualizacao,
  obterCookieCsrf,
  removerCookieAcesso,
  removerCookieAtualizacao,
  removerCookieCsrf,
} from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { revogacao } from "@/lib/revogacao";
import { hashToken } from "@/lib/token";

export async function DELETE(
  req: Request,
  { params }: RouteContext<"/api/auth/sessoes/[id]">,
) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

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

  // `revogadoEm: null` no filtro: se a sessão foi rotacionada entre a leitura
  // acima e este update, o motivo "rotacao" dela não pode ser sobrescrito —
  // é ele que mantém a detecção de reuso sobre esse token (ver revogacao.ts).
  await prisma.tokenAtualizacao.updateMany({
    where: { id, revogadoEm: null },
    data: revogacao("sessao_encerrada"),
  });

  const cookieAtual = await obterCookieAtualizacao();
  if (cookieAtual && hashToken(cookieAtual) === sessao.tokenHash) {
    await removerCookieAtualizacao();
    await removerCookieAcesso();
    await removerCookieCsrf();
  }

  return NextResponse.json({ sucesso: true });
}
