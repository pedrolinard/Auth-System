import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Testes automatizados sobem um servidor Next.js à parte (porta 3100,
  // banco de teste) em paralelo ao `npm run dev` manual — usar um distDir
  // próprio evita os dois disputarem o mesmo cache do Turbopack (já vimos
  // corrupção de cache nesta build por causa disso).
  distDir: process.env.VITEST_NEXT_DIST_DIR ?? ".next",
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
