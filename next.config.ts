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
const scriptSrc =
  process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const CSP = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
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
};

export default nextConfig;
