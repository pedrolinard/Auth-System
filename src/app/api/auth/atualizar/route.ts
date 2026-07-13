import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { definirCookieAtualizacao, obterCookieAtualizacao } from "@/lib/cookies";
import {
  gerarTokenAcesso,
  gerarTokenAtualizacao,
  hashToken,
  verificarTokenAtualizacao,
} from "@/lib/token";
import { esquemaAtualizacao } from "@/lib/validacao";

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => ({}));
  const tokenDoCorpo = esquemaAtualizacao.safeParse(corpo);

  // Aceita o token de atualização tanto pelo cookie (fluxo de navegador)
  // quanto pelo corpo da requisição (fluxo de apps/serviços sem cookies).
  const tokenRecebido =
    (await obterCookieAtualizacao()) ??
    (tokenDoCorpo.success ? tokenDoCorpo.data.tokenAtualizacao : undefined);

  if (!tokenRecebido) {
    return NextResponse.json(
      { erro: "Token de atualização não informado." },
      { status: 401 },
    );
  }

  const payload = await verificarTokenAtualizacao(tokenRecebido);
  if (!payload) {
    return NextResponse.json(
      { erro: "Token de atualização inválido ou expirado." },
      { status: 401 },
    );
  }

  const tokenHash = hashToken(tokenRecebido);
  const registroToken = await prisma.tokenAtualizacao.findUnique({
    where: { tokenHash },
    include: { usuario: true },
  });

  if (
    !registroToken ||
    registroToken.revogadoEm ||
    registroToken.expiraEm < new Date()
  ) {
    return NextResponse.json(
      { erro: "Token de atualização inválido ou expirado." },
      { status: 401 },
    );
  }

  // Rotação: revoga o token usado e emite um novo par de tokens.
  const { token: novoTokenAtualizacao, expiraEm: novaExpiracao } =
    await gerarTokenAtualizacao(registroToken.usuarioId);

  await prisma.$transaction([
    prisma.tokenAtualizacao.update({
      where: { id: registroToken.id },
      data: { revogadoEm: new Date() },
    }),
    prisma.tokenAtualizacao.create({
      data: {
        tokenHash: hashToken(novoTokenAtualizacao),
        usuarioId: registroToken.usuarioId,
        expiraEm: novaExpiracao,
      },
    }),
  ]);

  const novoTokenAcesso = await gerarTokenAcesso({
    sub: registroToken.usuario.id,
    email: registroToken.usuario.email,
  });

  await definirCookieAtualizacao(novoTokenAtualizacao);

  return NextResponse.json({
    tokenAcesso: novoTokenAcesso,
    tokenAtualizacao: novoTokenAtualizacao,
  });
}
