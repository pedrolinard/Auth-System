import { NextResponse } from "next/server";
import { autenticarAplicacao } from "@/lib/aplicacao";
import { obterCookieDispositivoConfiavel } from "@/lib/cookies";
import { autenticarComSenha } from "@/lib/loginSenha";
import { criarSessao } from "@/lib/sessao";

// Login por e-mail e senha. Tudo que protege a conta (limites, captcha,
// suspensão, alertas, MFA) está em src/lib/loginSenha.ts, compartilhado com o
// login hospedado do OpenID Connect.
export async function POST(req: Request) {
  // Origem cadastrada (navegador) ou client secret (servidor) — ver
  // autenticarAplicacao em src/lib/aplicacao.ts.
  const acessoAplicacao = await autenticarAplicacao(req);
  if (!acessoAplicacao.ok) {
    return NextResponse.json({ erro: acessoAplicacao.erro }, { status: acessoAplicacao.status });
  }

  const corpo = await req.json().catch(() => null);
  const resultado = await autenticarComSenha(
    req,
    acessoAplicacao.aplicacao,
    corpo,
    await obterCookieDispositivoConfiavel(),
  );

  if (resultado.tipo === "recusa") {
    return NextResponse.json(resultado.corpo, { status: resultado.status });
  }
  if (resultado.tipo === "mfa") {
    return NextResponse.json({ mfaObrigatorio: true, mfaToken: resultado.mfaToken });
  }
  return NextResponse.json(await criarSessao(resultado.usuario, req));
}
