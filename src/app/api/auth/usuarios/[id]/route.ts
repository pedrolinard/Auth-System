import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";

// Exclusão de conta por um admin — irreversível. TokenAtualizacao é
// removido em cascata (onDelete: Cascade no schema); LogAuditoria não tem FK
// de propósito, então o histórico de auditoria sobrevive à exclusão.
export async function DELETE(
  req: Request,
  { params }: RouteContext<"/api/auth/usuarios/[id]">,
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
      { erro: "Não é possível excluir a própria conta." },
      { status: 400 },
    );
  }

  const usuario = await prisma.usuario.findUnique({ where: { id } });
  if (!usuario) {
    return NextResponse.json({ erro: "Usuário não encontrado." }, { status: 404 });
  }

  await prisma.usuario.delete({ where: { id } });
  await registrarEvento({
    req,
    evento: "usuario_excluido_por_admin",
    usuarioId: id,
    email: usuario.email,
  });

  return NextResponse.json({ sucesso: true });
}
