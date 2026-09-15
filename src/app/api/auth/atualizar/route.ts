import { NextResponse } from "next/server";
import { aceitarIpDoUsuarioFinal } from "@/lib/aplicacao";
import {
  definirCookieAcesso,
  definirCookieAtualizacao,
  definirCookieCsrf,
  obterCookieAtualizacao,
  obterCookieCsrf,
} from "@/lib/cookies";
import { csrfValido, gerarTokenCsrf } from "@/lib/csrf";
import { ehAplicacaoPadrao } from "@/lib/gestaoAplicacoes";
import { rotacionarTokenAtualizacao } from "@/lib/rotacaoToken";
import { esquemaAtualizacao } from "@/lib/validacao";

// Renovação da sessão. Limite de falhas, tolerância de reapresentação,
// detecção de reuso e rotação concorrente: src/lib/rotacaoToken.ts.
export async function POST(req: Request) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

  // Backend cliente renovando por vários usuários: com o segredo, o limite de
  // falhas conta o IP de cada usuário, não o do servidor do cliente inteiro.
  await aceitarIpDoUsuarioFinal(req);

  const corpo = await req.json().catch(() => ({}));
  const tokenDoCorpo = esquemaAtualizacao.safeParse(corpo);

  // Aceita o token de atualização tanto pelo cookie (fluxo de navegador)
  // quanto pelo corpo da requisição (fluxo de apps/serviços sem cookies).
  const tokenRecebido =
    (await obterCookieAtualizacao()) ??
    (tokenDoCorpo.success ? tokenDoCorpo.data.tokenAtualizacao : undefined);

  const resultado = await rotacionarTokenAtualizacao(req, tokenRecebido);
  if (resultado.tipo === "recusa") {
    return NextResponse.json(resultado.corpo, { status: resultado.status });
  }

  // Cookie de sessão do painel só pra conta da aplicação padrão. Uma conta de
  // aplicação cliente (token vindo do SDK no corpo) renova e recebe os tokens
  // no JSON, mas não vira sessão no domínio do provedor.
  if (await ehAplicacaoPadrao(resultado.usuario.aplicacaoId)) {
    await definirCookieAtualizacao(resultado.tokenAtualizacao);
    await definirCookieAcesso(resultado.tokenAcesso);
    await definirCookieCsrf(gerarTokenCsrf());
  }

  return NextResponse.json({
    tokenAcesso: resultado.tokenAcesso,
    tokenAtualizacao: resultado.tokenAtualizacao,
  });
}
