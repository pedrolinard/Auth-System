import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { claimsDoUsuario } from "@/lib/oidc";
import { verificarTokenAcesso } from "@/lib/token";

// UserInfo do OpenID Connect: os dados da conta dona do access token. Só pelo
// header Authorization (nunca cookie: quem chama é a aplicação cliente).
// Token do login hospedado carrega `scope` e só recebe o que foi autorizado;
// token de sessão fora do OIDC (SDK) não tem escopo e recebe e-mail e nome —
// a conta é da própria aplicação que pergunta.
async function responder(req: Request) {
  const cabecalho = req.headers.get("authorization");
  const token = cabecalho?.startsWith("Bearer ") ? cabecalho.slice("Bearer ".length) : null;
  const payload = token ? await verificarTokenAcesso(token) : null;
  if (!payload) {
    return NextResponse.json(
      { error: "invalid_token", error_description: "Access token ausente, inválido ou expirado." },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer error="invalid_token"', "Cache-Control": "no-store" } },
    );
  }

  const usuario = await prisma.usuario.findUnique({
    where: { id: payload.sub },
    select: { id: true, nome: true, email: true, emailVerificado: true },
  });
  if (!usuario) {
    return NextResponse.json(
      { error: "invalid_token", error_description: "A conta não existe mais." },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer error="invalid_token"', "Cache-Control": "no-store" } },
    );
  }

  const escopos = payload.scope ? payload.scope.split(" ") : ["email", "profile"];
  return NextResponse.json(claimsDoUsuario(usuario, escopos), {
    headers: { "Cache-Control": "no-store" },
  });
}

export const GET = responder;
export const POST = responder;
