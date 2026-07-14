import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
