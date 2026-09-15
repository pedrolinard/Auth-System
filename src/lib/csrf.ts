import "server-only";

import { randomBytes } from "node:crypto";

import { compararEmTempoConstante } from "@/lib/cripto";

export function gerarTokenCsrf(): string {
  return randomBytes(32).toString("base64url");
}

// Cookies que autenticam uma requisição do navegador sozinhos (o navegador os
// manda de forma ambiente). Espelha NOME_COOKIE_ACESSO/NOME_COOKIE_ATUALIZACAO
// de cookies.ts — repetidos aqui pra este módulo não depender de next/headers.
const COOKIES_DE_SESSAO = ["tokenAcesso", "tokenAtualizacao"];

function temCookieDeSessao(req: Request): boolean {
  const cabecalho = req.headers.get("cookie");
  if (!cabecalho) return false;
  return cabecalho
    .split(";")
    .some((par) => COOKIES_DE_SESSAO.includes(par.trim().split("=")[0]));
}

// Double-submit cookie: o header X-CSRF-Token precisa bater com o cookie
// csrfToken — um site atacante em outra origem não consegue ler o cookie pra
// ecoar. A comparação é em tempo constante (compararEmTempoConstante) pra não
// vazar o valor esperado pela latência da resposta.
//
// Sem cookie CSRF, a checagem só é dispensada quando também não há cookie de
// SESSÃO na requisição (cliente sem navegador: curl, app com Bearer, fluxo de
// renovação com o token no corpo). Antes, bastava o cookie CSRF faltar pra
// passar — e uma requisição que chega autenticada pelo cookie de acesso sem o
// par CSRF é exatamente a forma de um CSRF, não de um cliente sem navegador.
export function csrfValido(req: Request, valorCookie: string | undefined): boolean {
  if (!valorCookie) return !temCookieDeSessao(req);
  const cabecalho = req.headers.get("x-csrf-token");
  if (!cabecalho) return false;
  return compararEmTempoConstante(cabecalho, valorCookie);
}
