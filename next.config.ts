import type { NextConfig } from "next";

// 'unsafe-inline' em script-src é um meio-termo consciente: um CSP realmente
// estrito (nonce por requisição) exigiria plugar isso no proxy.ts pra cada
// resposta, incluindo as páginas estáticas — mais invasivo, e o HMR do
// Turbopack em dev já injeta scripts inline (quebraria localmente). Ainda
// assim, restringir default-src/frame-ancestors/form-action já elimina a
// maior parte do risco de origem cruzada — melhor que não ter CSP nenhum.
// Em dev, o React precisa de eval() pra reconstruir call stacks (debugging) —
// "React will never use eval() in production mode", então isso não enfraquece
// o CSP de verdade, só evita quebrar `next dev` localmente.
// O widget do Cloudflare Turnstile (src/components/DesafioTurnstile.tsx)
// carrega um script de challenges.cloudflare.com e renderiza o desafio num
// iframe da própria Cloudflare, que por sua vez faz suas próprias chamadas de
// rede pra lá — sem liberar esses três diretivas o widget nem carrega (script
// bloqueado) ou carrega mas fica em branco (iframe/XHR bloqueados).
const ORIGEM_TURNSTILE = "https://challenges.cloudflare.com";
// O SDK do Rollbar (cliente) faz POST dos erros capturados pra este endpoint —
// sem liberar em connect-src, o relatório de erro do lado do navegador é
// bloqueado pelo CSP em silêncio (não é falha de segurança, mas cega o
// monitoramento de produção).
const ORIGEM_ROLLBAR = "https://api.rollbar.com";

const scriptSrc =
  process.env.NODE_ENV === "production"
    ? `script-src 'self' 'unsafe-inline' ${ORIGEM_TURNSTILE}`
    : `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${ORIGEM_TURNSTILE}`;

const CSP = [
  "default-src 'self'",
  scriptSrc,
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

const nextConfig: NextConfig = {
  // Testes automatizados sobem um servidor Next.js à parte (porta 3100,
  // banco de teste) em paralelo ao `npm run dev` manual — usar um distDir
  // próprio evita os dois disputarem o mesmo cache do Turbopack (já vimos
  // corrupção de cache nesta build por causa disso).
  distDir: process.env.VITEST_NEXT_DIST_DIR ?? ".next",
  // Remove o header X-Powered-By: Next.js (pequeno vazamento de informação
  // sobre a stack, sem função real pro cliente).
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/dominio/:path*",
        destination: `${process.env.DJANGO_SERVICE_URL}/api/dominio/:path*`,
      },
    ];
  },
  async redirects() {
    return [
      // O roadmap estático (public/roadmap.html) virou a página viva em
      // /roadmap (src/app/roadmap/page.tsx), renderizada a partir de
      // src/data/roadmap.ts — mantém quem tinha a URL antiga salva.
      { source: "/roadmap.html", destination: "/roadmap", permanent: false },
    ];
  },
};

export default nextConfig;
