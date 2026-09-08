import { NextResponse } from "next/server";

import { montarJwks } from "@/lib/chavesAssinatura";
import { DURACAO_TOKEN_ACESSO_SEGUNDOS } from "@/lib/token";

// JWKS público: o conjunto de chaves que valida os access tokens deste
// emissor. É o contrato com qualquer consumidor de fora — antes, a chave
// pública era distribuída por variável de ambiente (JWT_ACCESS_PUBLIC_KEY_B64),
// o que funciona quando o único consumidor é o seu próprio Django e deixa de
// funcionar no minuto em que existe um cliente que você não faz deploy.
//
// Nada aqui é segredo: são chaves PÚBLICAS, e é justamente por serem públicas
// que a rotação deixa de exigir coordenação — o consumidor descobre a chave
// nova sozinho, pelo `kid` do token.
export const dynamic = "force-dynamic";

export async function GET() {
  const jwks = await montarJwks();

  return NextResponse.json(jwks, {
    headers: {
      // Cacheável, mas por menos tempo que a vida de um access token: garante
      // que um consumidor nunca fique preso a um JWKS velho por mais tempo do
      // que o token que ele precisa validar. `stale-while-revalidate` evita
      // que a expiração do cache vire uma rajada de requisições sincronizadas.
      "cache-control": `public, max-age=${DURACAO_TOKEN_ACESSO_SEGUNDOS}, stale-while-revalidate=60`,
    },
  });
}
