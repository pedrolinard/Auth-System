import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verificarSenha } from "@/lib/senha";
import { criarSessao } from "@/lib/sessao";
import { gerarTokenDesafioMfa } from "@/lib/token";
import { esquemaLogin } from "@/lib/validacao";

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaLogin.safeParse(corpo);

  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const { email, senha } = dadosValidados.data;

  const usuario = await prisma.usuario.findUnique({ where: { email } });
  const credenciaisValidas =
    usuario && (await verificarSenha(senha, usuario.senhaHash));

  if (!credenciaisValidas) {
    return NextResponse.json(
      { erro: "E-mail ou senha inválidos." },
      { status: 401 },
    );
  }

  if (usuario.mfaAtivado) {
    const mfaToken = await gerarTokenDesafioMfa(usuario.id);
    return NextResponse.json({ mfaObrigatorio: true, mfaToken });
  }

  const sessao = await criarSessao(usuario);
  return NextResponse.json(sessao);
}
