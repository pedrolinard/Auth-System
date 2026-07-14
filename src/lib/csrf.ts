import "server-only";

import { randomBytes } from "node:crypto";

export function gerarTokenCsrf(): string {
  return randomBytes(32).toString("base64url");
}

// Double-submit cookie: se não existe cookie CSRF na requisição, não há
// sessão baseada em cookie em jogo (ex.: chamada via curl/Bearer) e a
// checagem não se aplica. Se existe, o header precisa bater exatamente —
// um site atacante em outra origem não consegue ler o cookie pra ecoar.
export function csrfValido(req: Request, valorCookie: string | undefined): boolean {
  if (!valorCookie) return true;
  const cabecalho = req.headers.get("x-csrf-token");
  return cabecalho === valorCookie;
}
