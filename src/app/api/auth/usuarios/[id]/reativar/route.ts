import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";

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
  if (payload.papel !== "admin") {
    return NextResponse.json(
      { erro: "Acesso restrito a administradores." },
      { status: 403 },
    );
  }

  const { id } = await params;

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
  });

  return NextResponse.json({ sucesso: true });
}
