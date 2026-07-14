import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autenticarRequisicao } from "@/lib/autenticar";

export async function GET(req: Request) {
  const payload = await autenticarRequisicao(req);

  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const usuario = await prisma.usuario.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      nome: true,
      email: true,
      criadoEm: true,
      mfaAtivado: true,
      emailVerificado: true,
      papel: true,
    },
  });

  if (!usuario) {
    return NextResponse.json(
      { erro: "Usuário não encontrado." },
      { status: 404 },
    );
  }

  return NextResponse.json({ usuario });
}
