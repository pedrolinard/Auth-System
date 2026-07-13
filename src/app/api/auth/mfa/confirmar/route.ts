import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autenticarRequisicao } from "@/lib/autenticar";
import { verificarCodigoMfa } from "@/lib/mfa";
import { esquemaCodigoMfa } from "@/lib/validacao";

export async function POST(req: Request) {
  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaCodigoMfa.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const usuario = await prisma.usuario.findUnique({
    where: { id: payload.sub },
  });
  if (!usuario?.mfaSecret) {
    return NextResponse.json(
      { erro: "Nenhuma ativação de MFA pendente. Chame /api/auth/mfa/iniciar primeiro." },
      { status: 400 },
    );
  }

  const codigoValido = verificarCodigoMfa(
    usuario.mfaSecret,
    usuario.email,
    dadosValidados.data.codigo,
  );
  if (!codigoValido) {
    return NextResponse.json({ erro: "Código inválido." }, { status: 401 });
  }

  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { mfaAtivado: true },
  });

  return NextResponse.json({ sucesso: true });
}
