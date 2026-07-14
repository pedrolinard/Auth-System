import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verificarTokenVerificacaoEmail } from "@/lib/token";
import { esquemaVerificacaoEmail } from "@/lib/validacao";

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaVerificacaoEmail.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const payload = await verificarTokenVerificacaoEmail(dadosValidados.data.token);
  if (!payload) {
    return NextResponse.json(
      { erro: "Link de verificação inválido ou expirado." },
      { status: 401 },
    );
  }

  await prisma.usuario.update({
    where: { id: payload.sub },
    data: { emailVerificado: true },
  });

  return NextResponse.json({ sucesso: true });
}
