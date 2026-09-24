import { NextResponse } from "next/server";

import { registrarEvento } from "@/lib/auditoria";
import { autenticarClienteOidc, trocarCodigoPorTokens, type ErroOAuth } from "@/lib/oidc";
import { limiteExcedido, obterIp, reservarTentativas } from "@/lib/rateLimit";
import { rotacionarTokenAtualizacao } from "@/lib/rotacaoToken";
import { DURACAO_TOKEN_ACESSO_SEGUNDOS } from "@/lib/token";

// Endpoint de token do OpenID Connect (RFC 6749 §3.2): troca o código de
// autorização por tokens e renova com refresh_token. Formato de erro e
// cabeçalhos seguem a especificação, porque quem chama é uma biblioteca
// OAuth, não o painel.

const MAX_FALHAS = 30;
const JANELA_FALHAS_MS = 15 * 60 * 1000;

const SEM_CACHE = { "Cache-Control": "no-store", Pragma: "no-cache" };

function respostaErro(erro: ErroOAuth) {
  return NextResponse.json(
    { error: erro.error, error_description: erro.error_description },
    {
      status: erro.status,
      headers: {
        ...SEM_CACHE,
        ...(erro.basic ? { "WWW-Authenticate": 'Basic realm="oidc"' } : {}),
      },
    },
  );
}

async function lerCampos(req: Request): Promise<URLSearchParams> {
  const tipo = req.headers.get("content-type") ?? "";
  if (tipo.includes("application/x-www-form-urlencoded")) {
    return new URLSearchParams(await req.text());
  }
  // Algumas bibliotecas mandam JSON; aceita também, só com valores de texto.
  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const campos = new URLSearchParams();
  for (const [chave, valor] of Object.entries(corpo ?? {})) {
    if (typeof valor === "string") campos.set(chave, valor);
  }
  return campos;
}

export async function POST(req: Request) {
  const ip = obterIp(req);
  if (await limiteExcedido({ ip, evento: "oidc_token_falha", maximo: MAX_FALHAS })) {
    return respostaErro({ status: 429, error: "slow_down", error_description: "Muitas tentativas. Tente mais tarde." });
  }
  // Reservada ANTES de conferir client secret e código (ver
  // reservarTentativas): o check acima só lê, e pedidos simultâneos passariam
  // todos por ele. Falha mantém a reserva; os caminhos que dão certo — e a
  // renovação, que tem limite próprio em rotacionarTokenAtualizacao — liberam.
  const reserva = await reservarTentativas([
    { ip, evento: "oidc_token_falha", maximo: MAX_FALHAS, janelaMs: JANELA_FALHAS_MS },
  ]);
  if (!reserva) {
    return respostaErro({ status: 429, error: "slow_down", error_description: "Muitas tentativas. Tente mais tarde." });
  }
  const falhar = (erro: ErroOAuth) => respostaErro(erro);

  const campos = await lerCampos(req);
  const acesso = await autenticarClienteOidc(req, campos);
  if (!acesso.ok) return falhar(acesso.erro);
  const { cliente } = acesso;

  const tipoConcessao = campos.get("grant_type");

  if (tipoConcessao === "authorization_code") {
    const resultado = await trocarCodigoPorTokens(req, cliente, campos);
    if (!resultado.ok) return falhar(resultado.erro);
    await reserva.liberar();
    await registrarEvento({ req, evento: "oidc_codigo_trocado", aplicacaoId: cliente.aplicacaoId });
    return NextResponse.json(resultado.resposta, { headers: SEM_CACHE });
  }

  if (tipoConcessao === "refresh_token") {
    await reserva.liberar();
    const resultado = await rotacionarTokenAtualizacao(req, campos.get("refresh_token") ?? undefined, {
      aplicacaoId: cliente.aplicacaoId,
    });
    if (resultado.tipo === "recusa") {
      if (resultado.status === 429) {
        return respostaErro({ status: 429, error: "slow_down", error_description: "Muitas tentativas. Tente mais tarde." });
      }
      if (resultado.status >= 500) {
        return respostaErro({ status: 500, error: "server_error", error_description: "Não foi possível renovar agora." });
      }
      return respostaErro({ status: 400, error: "invalid_grant", error_description: "refresh_token inválido ou expirado." });
    }
    return NextResponse.json(
      {
        access_token: resultado.tokenAcesso,
        token_type: "Bearer",
        expires_in: DURACAO_TOKEN_ACESSO_SEGUNDOS,
        refresh_token: resultado.tokenAtualizacao,
      },
      { headers: SEM_CACHE },
    );
  }

  return falhar({
    status: 400,
    error: "unsupported_grant_type",
    error_description: "grant_type deve ser authorization_code ou refresh_token.",
  });
}
