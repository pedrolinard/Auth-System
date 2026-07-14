import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autenticarRequisicao } from "@/lib/autenticar";

// Rota de exemplo só para provar o RBAC mínimo (Usuario.papel) ponta a
// ponta — lista todos os usuários, acessível apenas para quem tem papel
// "admin".
export async function GET(req: Request) {
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

  const usuarios = await prisma.usuario.findMany({
    select: { id: true, nome: true, email: true, papel: true, criadoEm: true },
    orderBy: { criadoEm: "asc" },
  });

  return NextResponse.json({ usuarios });
}
