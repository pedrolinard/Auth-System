import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { claimsDoUsuario } from "@/lib/oidc";
import { verificarTokenAcesso } from "@/lib/token";

// UserInfo do OpenID Connect: os dados da conta dona do access token. Só pelo
// header Authorization (nunca cookie: quem chama é a aplicação cliente). O
// access token não carrega escopo, então devolve e-mail e nome, que são os
// mesmos que o id_token já entrega com email/profile.
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

  return NextResponse.json(claimsDoUsuario(usuario, ["email", "profile"]), {
    headers: { "Cache-Control": "no-store" },
  });
}

export const GET = responder;
export const POST = responder;
