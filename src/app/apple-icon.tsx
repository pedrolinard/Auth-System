import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 32 32"
        width={180}
        height={180}
      >
        <rect width="32" height="32" rx="7" fill="#0a0a0a" />
        {/* Assinatura visual do JWT: header.payload.signature como três
            blocos separados por pontos, inclinados para ler como string
            codificada — em vez de mais um cadeado genérico. */}
        <g transform="rotate(-18 16 16)">
          <rect x="4" y="12.5" width="4" height="7" rx="2" fill="#ededed" />
          <circle cx="9.5" cy="16" r="1.6" fill="#ededed" />
          <rect x="11" y="12.5" width="10" height="7" rx="2" fill="#ededed" />
          <circle cx="22.5" cy="16" r="1.6" fill="#ededed" />
          <rect x="24" y="12.5" width="4" height="7" rx="2" fill="#ededed" />
        </g>
      </svg>
    ),
    { ...size },
  );
}
