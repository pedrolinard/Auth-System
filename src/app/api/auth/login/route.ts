import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verificarSenha } from "@/lib/senha";
import { definirCookieAtualizacao } from "@/lib/cookies";
import { gerarTokenAcesso, gerarTokenAtualizacao, hashToken } from "@/lib/token";
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

  const tokenAcesso = await gerarTokenAcesso({
    sub: usuario.id,
    email: usuario.email,
  });
  const {
    token: tokenAtualizacao,
    expiraEm,
  } = await gerarTokenAtualizacao(usuario.id);

  await prisma.tokenAtualizacao.create({
    data: {
      tokenHash: hashToken(tokenAtualizacao),
      usuarioId: usuario.id,
      expiraEm,
    },
  });

  await definirCookieAtualizacao(tokenAtualizacao);

  return NextResponse.json({
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email },
    tokenAcesso,
    tokenAtualizacao,
  });
}
