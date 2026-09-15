import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { criarSessao } from "@/lib/sessao";
import { estaSuspenso, mensagemSuspensaoOrganizacao } from "@/lib/suspensao";

// Troca a organização ATIVA da sessão pra uma outra de que o usuário já é
// membro — reemite o par de tokens (mesmo formato do login), sem pedir
// senha de novo. Não existe "sessão com várias organizações ao mesmo
// tempo": trocar aqui troca em todas as abas do navegador (é o mesmo cookie
// httpOnly) — trade-off de design aceito, ver o plano de implementação do
// multi-tenant.
export async function POST(
  req: Request,
  { params }: RouteContext<"/api/auth/organizacoes/[id]/entrar">,
) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const { id: organizacaoId } = await params;

  const membro = await prisma.membro.findUnique({
    where: { organizacaoId_usuarioId: { organizacaoId, usuarioId: payload.sub } },
  });
  if (!membro) {
    return NextResponse.json(
      { erro: "Você não é membro desta organização." },
      { status: 404 },
    );
  }
  // Depois da checagem de filiação, não antes: quem não é membro recebe o 404
  // de sempre, e só quem é membro fica sabendo da própria suspensão.
  if (estaSuspenso(membro)) {
    return NextResponse.json({ erro: mensagemSuspensaoOrganizacao(membro) }, { status: 403 });
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });
  if (!usuario) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const sessao = await criarSessao(usuario, req, organizacaoId);
  return NextResponse.json(sessao);
}
