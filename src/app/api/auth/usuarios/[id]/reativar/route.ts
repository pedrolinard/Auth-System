import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { obterMembroDaOrganizacao, temPapelOrganizacao } from "@/lib/rbacOrganizacao";

export async function POST(
  req: Request,
  { params }: RouteContext<"/api/auth/usuarios/[id]/reativar">,
) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }
  if (!temPapelOrganizacao(payload.papelOrganizacao, ["dono", "admin"])) {
    return NextResponse.json(
      { erro: "Acesso restrito a administradores da organização." },
      { status: 403 },
    );
  }

  const { id } = await params;

  if (!(await obterMembroDaOrganizacao(payload.organizacaoId, id))) {
    return NextResponse.json(
      { erro: "Usuário não encontrado nesta organização." },
      { status: 404 },
    );
  }

  const usuario = await prisma.usuario.findUnique({ where: { id } });
  if (!usuario) {
    return NextResponse.json({ erro: "Usuário não encontrado." }, { status: 404 });
  }

  await prisma.usuario.update({
    where: { id },
    data: { suspenso: false, suspensoAte: null, suspensoMotivo: null },
  });

  await registrarEvento({
    req,
    evento: "usuario_reativado_por_admin",
    usuarioId: id,
    email: usuario.email,
    autorId: payload.sub,
    autorEmail: payload.email,
  });

  return NextResponse.json({ sucesso: true });
}
