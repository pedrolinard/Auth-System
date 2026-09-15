import { NextResponse } from "next/server";

import { documentoDescoberta } from "@/lib/oidc";

// Discovery do OpenID Connect: é o que bibliotecas prontas (next-auth,
// openid-client, Spring Security, o login de qualquer SaaS) leem pra saber
// onde autorizar, trocar o código e validar o id_token. Público, sem segredo.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(documentoDescoberta(), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
