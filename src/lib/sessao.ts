import "server-only";

import { prisma } from "@/lib/db";
import { definirCookieAtualizacao } from "@/lib/cookies";
import { gerarTokenAcesso, gerarTokenAtualizacao, hashToken } from "@/lib/token";

type UsuarioParaSessao = {
  id: string;
  nome: string;
  email: string;
};

// Emite o par de tokens (acesso + atualização), persiste o hash do token de
// atualização e seta o cookie httpOnly. Usado tanto pelo login direto quanto
// pela conclusão do desafio de MFA, para os dois caminhos terminarem no mesmo
// formato de sessão.
export async function criarSessao(usuario: UsuarioParaSessao) {
  const tokenAcesso = await gerarTokenAcesso({
    sub: usuario.id,
    email: usuario.email,
  });
  const { token: tokenAtualizacao, expiraEm } = await gerarTokenAtualizacao(
    usuario.id,
  );

  await prisma.tokenAtualizacao.create({
    data: {
      tokenHash: hashToken(tokenAtualizacao),
      usuarioId: usuario.id,
      expiraEm,
    },
  });

  await definirCookieAtualizacao(tokenAtualizacao);

  return {
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email },
    tokenAcesso,
    tokenAtualizacao,
  };
}
