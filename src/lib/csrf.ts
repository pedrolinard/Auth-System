import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";

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
  if (!cabecalho) return false;

  // timingSafeEqual exige buffers do mesmo tamanho — comparar o tamanho
  // antes não vaza nada útil (o tamanho do token CSRF é sempre o mesmo,
  // fixo pelo gerarTokenCsrf acima), só evita o comparando byte a byte
  // sem essa checagem lançar em vez de simplesmente reprovar.
  const bufferCabecalho = Buffer.from(cabecalho);
  const bufferCookie = Buffer.from(valorCookie);
  if (bufferCabecalho.length !== bufferCookie.length) return false;

  return timingSafeEqual(bufferCabecalho, bufferCookie);
}
