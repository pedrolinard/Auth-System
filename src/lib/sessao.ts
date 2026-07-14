import "server-only";

import { prisma } from "@/lib/db";
import {
  definirCookieAcesso,
  definirCookieAtualizacao,
  definirCookieCsrf,
} from "@/lib/cookies";
import { gerarTokenCsrf } from "@/lib/csrf";
import {
  gerarTokenAcesso,
  gerarTokenAtualizacao,
  hashToken,
  type Papel,
} from "@/lib/token";

type UsuarioParaSessao = {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
};

// Emite o par de tokens (acesso + atualização), persiste o hash do token de
// atualização e seta o cookie httpOnly. Usado tanto pelo login direto quanto
// pela conclusão do desafio de MFA, para os dois caminhos terminarem no mesmo
// formato de sessão.
export async function criarSessao(usuario: UsuarioParaSessao) {
  const tokenAcesso = await gerarTokenAcesso({
    sub: usuario.id,
    email: usuario.email,
    papel: usuario.papel,
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
  await definirCookieAcesso(tokenAcesso);
  await definirCookieCsrf(gerarTokenCsrf());

  return {
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email },
    tokenAcesso,
    tokenAtualizacao,
  };
}
