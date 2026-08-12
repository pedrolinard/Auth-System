"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ) => string;
      remove: (widgetId: string) => void;
    };
  }
}

// Só existe em produção com o par TURNSTILE_SECRET_KEY (backend, ver
// src/lib/turnstile.ts) + NEXT_PUBLIC_TURNSTILE_SITE_KEY (aqui) configurado —
// sem a site key, o componente simplesmente não renderiza nada, mesmo
// princípio de fallback do resto do projeto (não trava dev/test por falta de
// uma chave de produção).
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

// Renderizado só quando o servidor responde `captchaNecessario: true` (ver
// login/cadastro) — fricção progressiva, não aparece pra quem nunca errou
// login/cadastro demais. `key` do lado de quem usa este componente deve
// mudar a cada tentativa reprovada: o token do Turnstile é de uso único, e
// remontar o componente é o jeito mais simples de pedir um novo ao Cloudflare
// (equivalente a chamar `turnstile.reset`).
export function DesafioTurnstile({
  onToken,
}: {
  onToken: (token: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [scriptPronto, setScriptPronto] = useState(false);

  useEffect(() => {
    if (!scriptPronto || !containerRef.current || !window.turnstile) return;

    const id = window.turnstile.render(containerRef.current, {
      sitekey: SITE_KEY!,
      callback: onToken,
      "expired-callback": () => onToken(null),
      "error-callback": () => onToken(null),
    });
    widgetId.current = id;

    return () => {
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
    };
  }, [scriptPronto, onToken]);

  if (!SITE_KEY) return null;

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onReady={() => setScriptPronto(true)}
      />
      <div ref={containerRef} className="flex justify-center" />
    </>
  );
}
