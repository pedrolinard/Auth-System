// Content-Security-Policy do projeto, em dois sabores:
//
// - PÁGINAS: gerada por requisição no proxy.ts, com nonce. `script-src` não
//   tem mais 'unsafe-inline' — um script injetado por XSS não carrega o nonce
//   da resposta e não roda. O preço é que toda página passa a ser renderizada
//   dinamicamente (o nonce só existe na requisição; HTML pré-gerado no build
//   sairia sem ele e com os próprios scripts do Next bloqueados). Ver o
//   layout raiz, que força isso. Aceito de propósito: num serviço de
//   autenticação, XSS vale o token de quem está logado, e as páginas daqui
//   são poucas e leves.
//
// - RESPOSTAS SEM HTML (rotas de API, assets): uma política fixa e fechada,
//   via next.config.ts. JSON não executa script; o que importa é não poder
//   ser embutido nem virar documento com privilégio.

// O widget do Cloudflare Turnstile (src/components/DesafioTurnstile.tsx)
// carrega um script de challenges.cloudflare.com e renderiza o desafio num
// iframe da própria Cloudflare, que faz suas próprias chamadas de rede pra lá
// — sem liberar essas três diretivas o widget nem carrega (script bloqueado)
// ou carrega mas fica em branco (iframe/XHR bloqueados).
export const ORIGEM_TURNSTILE = "https://challenges.cloudflare.com";
// O SDK do Rollbar (cliente) faz POST dos erros capturados pra este endpoint —
// sem liberar em connect-src, o relatório de erro do lado do navegador é
// bloqueado pelo CSP em silêncio (cega o monitoramento de produção).
export const ORIGEM_ROLLBAR = "https://api.rollbar.com";

export function gerarNonce(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function cspDePagina(nonce: string, desenvolvimento: boolean): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic': script carregado por um script que já tem o nonce
    // (chunks do Next, o next/script do Turnstile) herda a confiança — por
    // isso os bundles não precisam de nonce um a um. Navegadores com CSP3
    // ignoram 'self' e a origem do Turnstile quando 'strict-dynamic' está
    // presente; os dois ficam como fallback pros que não entendem.
    // Em dev, o React usa eval() pra reconstruir call stacks — "React will
    // never use eval() in production mode".
    [
      "script-src 'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ORIGEM_TURNSTILE,
      desenvolvimento ? "'unsafe-eval'" : "",
    ]
      .filter(Boolean)
      .join(" "),
    // Estilo segue com 'unsafe-inline': atributos style="" (do React, do
    // iframe do Turnstile) não aceitam nonce, e CSS injetado não executa
    // código — o ganho de fechar isto não paga a quebra.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src 'self' ${ORIGEM_TURNSTILE} ${ORIGEM_ROLLBAR}`,
    `frame-src ${ORIGEM_TURNSTILE}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Explícito em vez de herdar de default-src: nenhum plugin Flash/applet.
    "object-src 'none'",
    // Qualquer sub-recurso http:// numa página https:// é reescrito pra https.
    "upgrade-insecure-requests",
  ].join("; ");
}

export const CSP_SEM_HTML = [
  "default-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");
