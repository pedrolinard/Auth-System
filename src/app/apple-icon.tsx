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
        <rect width="32" height="32" rx="7" fill="#0b0e0d" />
        <path
          d="M11 15 V11 A5 5 0 0 1 21 11 V15"
          fill="none"
          stroke="#63b6a0"
          strokeWidth="2.3"
          strokeLinecap="round"
        />
        <rect x="8.5" y="14.5" width="15" height="11.5" rx="2.6" fill="#63b6a0" />
        <circle cx="16" cy="19" r="1.6" fill="#0b0e0d" />
      </svg>
    ),
    { ...size },
  );
}
