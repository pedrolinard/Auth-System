import "server-only";

import { cookies } from "next/headers";
import { DURACAO_TOKEN_ATUALIZACAO_MS } from "@/lib/token";

export const NOME_COOKIE_ATUALIZACAO = "tokenAtualizacao";

export async function definirCookieAtualizacao(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(NOME_COOKIE_ATUALIZACAO, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DURACAO_TOKEN_ATUALIZACAO_MS / 1000,
  });
}

export async function removerCookieAtualizacao() {
  const cookieStore = await cookies();
  cookieStore.delete({ name: NOME_COOKIE_ATUALIZACAO, path: "/" });
}

export async function obterCookieAtualizacao() {
  const cookieStore = await cookies();
  return cookieStore.get(NOME_COOKIE_ATUALIZACAO)?.value;
}
