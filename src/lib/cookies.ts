import "server-only";

import { cookies } from "next/headers";
import {
  DURACAO_TOKEN_ACESSO_SEGUNDOS,
  DURACAO_TOKEN_ATUALIZACAO_MS,
} from "@/lib/token";

export const NOME_COOKIE_ATUALIZACAO = "tokenAtualizacao";
export const NOME_COOKIE_ACESSO = "tokenAcesso";

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

// Access token em cookie httpOnly em vez de sessionStorage: elimina a
// exposição a roubo via XSS (JS não consegue ler este cookie). O rewrite de
// /api/dominio/* em next.config.ts repassa cookies transparentemente, então
// o Django também recebe este cookie nas chamadas feitas pelo navegador.
export async function definirCookieAcesso(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(NOME_COOKIE_ACESSO, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DURACAO_TOKEN_ACESSO_SEGUNDOS,
  });
}

export async function removerCookieAcesso() {
  const cookieStore = await cookies();
  cookieStore.delete({ name: NOME_COOKIE_ACESSO, path: "/" });
}

export async function obterCookieAcesso() {
  const cookieStore = await cookies();
  return cookieStore.get(NOME_COOKIE_ACESSO)?.value;
}

// Cookie CSRF (double-submit): propositalmente NÃO httpOnly, o cliente
// precisa ler o valor (document.cookie) pra ecoar no header X-CSRF-Token.
// Não é um segredo — só prova que quem fez a requisição consegue ler
// cookies do próprio site, o que um site atacante em outra origem não
// consegue.
export const NOME_COOKIE_CSRF = "csrfToken";

export async function definirCookieCsrf(valor: string) {
  const cookieStore = await cookies();
  cookieStore.set(NOME_COOKIE_CSRF, valor, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DURACAO_TOKEN_ATUALIZACAO_MS / 1000,
  });
}

export async function removerCookieCsrf() {
  const cookieStore = await cookies();
  cookieStore.delete({ name: NOME_COOKIE_CSRF, path: "/" });
}

export async function obterCookieCsrf() {
  const cookieStore = await cookies();
  return cookieStore.get(NOME_COOKIE_CSRF)?.value;
}
