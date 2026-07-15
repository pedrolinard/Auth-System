import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { esquemaSuspensao } from "@/lib/validacao";

export async function POST(
  req: Request,
  { params }: RouteContext<"/api/auth/usuarios/[id]/suspender">,
) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }
  if (payload.papel !== "admin") {
    return NextResponse.json(
      { erro: "Acesso restrito a administradores." },
      { status: 403 },
    );
  }

  const { id } = await params;
  if (id === payload.sub) {
    return NextResponse.json(
      { erro: "Não é possível suspender a própria conta." },
      { status: 400 },
    );
  }

  const corpo = await req.json().catch(() => ({}));
  const dadosValidados = esquemaSuspensao.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const usuario = await prisma.usuario.findUnique({ where: { id } });
  if (!usuario) {
    return NextResponse.json({ erro: "Usuário não encontrado." }, { status: 404 });
  }

  const { dias, motivo } = dadosValidados.data;
  const suspensoAte = dias ? new Date(Date.now() + dias * 24 * 60 * 60 * 1000) : null;

  await prisma.usuario.update({
    where: { id },
    data: {
      suspenso: true,
      suspensoAte,
      suspensoMotivo: motivo ?? null,
    },
  });

  // Derruba as sessões ativas na hora. O access token de até 15 min ainda
  // vale até expirar naturalmente — mesmo trade-off já aceito em "sair de
  // todos os dispositivos" (JWT stateless não dá pra revogar no meio do voo).
  await prisma.tokenAtualizacao.updateMany({
    where: { usuarioId: id, revogadoEm: null },
    data: { revogadoEm: new Date() },
  });

  await registrarEvento({
    req,
    evento: "usuario_suspenso_por_admin",
    usuarioId: id,
    email: usuario.email,
  });

  return NextResponse.json({ sucesso: true });
}
