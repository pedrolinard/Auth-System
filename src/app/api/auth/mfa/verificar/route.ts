import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { criarSessao } from "@/lib/sessao";
import { verificarCodigoMfa } from "@/lib/mfa";
import { verificarTokenDesafioMfa } from "@/lib/token";
import { esquemaVerificacaoMfa } from "@/lib/validacao";

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaVerificacaoMfa.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const { mfaToken, codigo } = dadosValidados.data;

  const payload = await verificarTokenDesafioMfa(mfaToken);
  if (!payload) {
    return NextResponse.json(
      { erro: "Desafio de MFA inválido ou expirado. Faça login novamente." },
      { status: 401 },
    );
  }

  const usuario = await prisma.usuario.findUnique({
    where: { id: payload.sub },
  });
  if (!usuario?.mfaAtivado || !usuario.mfaSecret) {
    return NextResponse.json(
      { erro: "Desafio de MFA inválido ou expirado. Faça login novamente." },
      { status: 401 },
    );
  }

  const codigoValido = verificarCodigoMfa(usuario.mfaSecret, usuario.email, codigo);
  if (!codigoValido) {
    return NextResponse.json({ erro: "Código inválido." }, { status: 401 });
  }

  const sessao = await criarSessao(usuario);
  return NextResponse.json(sessao);
}
