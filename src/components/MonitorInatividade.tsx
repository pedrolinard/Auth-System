"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { sair } from "@/lib/clienteAuth";

const TEMPO_INATIVIDADE_MS = 5 * 60 * 1000;
// mousemove dispara dezenas de vezes por segundo — sem isso, cada pixel de
// movimento cancelaria e recriaria o setTimeout à toa.
const THROTTLE_MS = 1000;
const EVENTOS_ATIVIDADE = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click",
] as const;

// Fica montado em todas as telas de /dashboard (via layout.tsx) e desloga
// automaticamente após TEMPO_INATIVIDADE_MS sem nenhuma interação — mesmo
// padrão de "sair" já usado no resto do sistema (limpa cookies + revoga a
// sessão no banco), só que disparado pelo timer em vez de um clique.
export function MonitorInatividade() {
  const router = useRouter();
  const temporizadorRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultimoResetRef = useRef(0);

  const aoInativo = useCallback(async () => {
    await sair();
    router.replace("/login");
  }, [router]);

  const reiniciarTemporizador = useCallback(() => {
    const agora = Date.now();
    if (agora - ultimoResetRef.current < THROTTLE_MS) return;
    ultimoResetRef.current = agora;

    if (temporizadorRef.current) clearTimeout(temporizadorRef.current);
    temporizadorRef.current = setTimeout(aoInativo, TEMPO_INATIVIDADE_MS);
  }, [aoInativo]);

  useEffect(() => {
    reiniciarTemporizador();
    for (const evento of EVENTOS_ATIVIDADE) {
      window.addEventListener(evento, reiniciarTemporizador, { passive: true });
    }
    return () => {
      if (temporizadorRef.current) clearTimeout(temporizadorRef.current);
      for (const evento of EVENTOS_ATIVIDADE) {
        window.removeEventListener(evento, reiniciarTemporizador);
      }
    };
  }, [reiniciarTemporizador]);

  return null;
}
