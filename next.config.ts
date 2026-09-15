import type { NextConfig } from "next";
import { CSP_SEM_HTML } from "./src/lib/csp";

// O CSP das PÁGINAS não mora aqui: ele leva um nonce novo por requisição e é
// montado no src/proxy.ts (ver src/lib/csp.ts). Aqui fica só a política fixa
// das rotas de API, que não servem HTML.

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
        source: "/api/:path*",
        headers: [{ key: "Content-Security-Policy", value: CSP_SEM_HTML }],
      },
      {
        // Chaves PÚBLICAS: qualquer backend ou navegador de cliente precisa
        // conseguir ler o JWKS pra validar tokens. Nada de credencial aqui.
        source: "/.well-known/jwks.json",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
      {
        source: "/:path*",
        headers: [
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
    // Sem DJANGO_SERVICE_URL o destino virava "undefined/api/dominio/..." e o
    // Next recusa o build inteiro ("Invalid rewrite found") — é o que mantinha
    // todo deploy de Preview em erro, já que a variável só existe em
    // Production. Sem o serviço configurado, /api/dominio simplesmente não
    // existe nesse ambiente (404), e o resto do app sobe normalmente.
    const servicoDominio = process.env.DJANGO_SERVICE_URL;
    if (!servicoDominio) return [];
    return [
      {
        source: "/api/dominio/:path*",
        destination: `${servicoDominio}/api/dominio/:path*`,
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
