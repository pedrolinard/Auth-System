import { NextResponse } from "next/server";

import { obterAplicacaoPorId } from "@/lib/aplicacao";
import { registrarEvento } from "@/lib/auditoria";
import { obterCookieDispositivoConfiavel } from "@/lib/cookies";
import { autenticarComSenha } from "@/lib/loginSenha";
import { emitirCodigoAutorizacao, origemDoProprioProvedor, verificarPedidoAssinado } from "@/lib/oidc";

// Login da página hospedada (/autorizar). Mesmas proteções do login do painel
// (src/lib/loginSenha.ts); no fim, em vez de sessão, devolve a URL de retorno
// com o código de autorização.
//
// CSRF de login (um site fazer o navegador de alguém entrar numa conta do
// atacante): esta rota só aceita a própria origem do provedor, não tem CORS
// (fora do matcher do proxy) e exige o pedido assinado que só /autorizar emite.

const PEDIDO_EXPIRADO = {
  erro: "Este pedido de login expirou. Volte para o aplicativo e tente entrar de novo.",
};

export async function POST(req: Request) {
  if (!origemDoProprioProvedor(req)) {
    return NextResponse.json({ erro: "Origem não autorizada." }, { status: 403 });
  }

  const corpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const pedido = await verificarPedidoAssinado(corpo?.pedido);
  if (!pedido) return NextResponse.json(PEDIDO_EXPIRADO, { status: 400 });

  const aplicacao = await obterAplicacaoPorId(pedido.aplicacaoId);
  if (!aplicacao) return NextResponse.json(PEDIDO_EXPIRADO, { status: 400 });

  const resultado = await autenticarComSenha(req, aplicacao, corpo, await obterCookieDispositivoConfiavel());
  if (resultado.tipo === "recusa") {
    return NextResponse.json(resultado.corpo, { status: resultado.status });
  }
  if (resultado.tipo === "mfa") {
    return NextResponse.json({ mfaObrigatorio: true, mfaToken: resultado.mfaToken });
  }

  const redirecionar = await emitirCodigoAutorizacao(pedido, resultado.usuario);
  if (!redirecionar) return NextResponse.json(PEDIDO_EXPIRADO, { status: 400 });
  await registrarEvento({
    req,
    evento: "oidc_codigo_emitido",
    usuarioId: resultado.usuario.id,
    email: resultado.usuario.email,
    aplicacaoId: pedido.aplicacaoId,
  });
  return NextResponse.json({ redirecionar });
}
