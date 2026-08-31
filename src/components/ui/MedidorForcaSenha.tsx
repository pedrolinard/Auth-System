"use client";

import { Check } from "lucide-react";

// Guia de senha no cliente — reflete as regras reais do servidor
// (src/lib/validacao.ts: 8+ caracteres, ao menos uma letra e um número) mais
// uma barra de "força além do mínimo". O servidor ainda faz a checagem
// definitiva, inclusive vazamentos (HIBP); isto aqui é só pra ninguém
// descobrir o requisito no erro do submit.

function bytesUtf8(texto: string) {
  return new TextEncoder().encode(texto).length;
}

type Nivel = { rotulo: string; barras: number; cor: string };

export function avaliarSenha(senha: string) {
  const requisitos = [
    { rotulo: "8 caracteres ou mais", ok: senha.length >= 8 },
    { rotulo: "uma letra", ok: /[a-zA-Z]/.test(senha) },
    { rotulo: "um número", ok: /[0-9]/.test(senha) },
  ];
  const longaDemais = bytesUtf8(senha) > 72;

  let pontos = 0;
  if (senha.length >= 8) pontos++;
  if (senha.length >= 12) pontos++;
  if (/[a-z]/.test(senha) && /[A-Z]/.test(senha)) pontos++;
  if (/[0-9]/.test(senha)) pontos++;
  if (/[^a-zA-Z0-9]/.test(senha)) pontos++;

  const niveis: Nivel[] = [
    { rotulo: "fraca", barras: 1, cor: "bg-red-500" },
    { rotulo: "fraca", barras: 1, cor: "bg-red-500" },
    { rotulo: "ok", barras: 2, cor: "bg-amber-500" },
    { rotulo: "boa", barras: 3, cor: "bg-[var(--accent)]" },
    { rotulo: "forte", barras: 4, cor: "bg-[var(--accent)]" },
    { rotulo: "forte", barras: 4, cor: "bg-[var(--accent)]" },
  ];

  return {
    requisitos,
    longaDemais,
    nivel: niveis[Math.min(pontos, niveis.length - 1)],
    atendeMinimo: requisitos.every((r) => r.ok) && !longaDemais,
  };
}

export function MedidorForcaSenha({ senha }: { senha: string }) {
  if (!senha) return null;
  const { requisitos, longaDemais, nivel } = avaliarSenha(senha);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors duration-200 ${
                i < nivel.barras ? nivel.cor : "bg-black/[.08] dark:bg-white/[.1]"
              }`}
            />
          ))}
        </div>
        <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{nivel.rotulo}</span>
      </div>

      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {requisitos.map((req) => (
          <li
            key={req.rotulo}
            className={`flex items-center gap-1 text-xs transition-colors ${
              req.ok
                ? "text-zinc-600 dark:text-zinc-300"
                : "text-zinc-400 dark:text-zinc-500"
            }`}
          >
            <Check
              className={`h-3 w-3 ${req.ok ? "text-[var(--accent)]" : "text-zinc-300 dark:text-zinc-600"}`}
              strokeWidth={3}
            />
            {req.rotulo}
          </li>
        ))}
      </ul>

      {longaDemais && (
        <p className="text-xs text-red-600 dark:text-red-400">
          Longa demais — acentos e emoji contam como 2+ caracteres (máx. 72).
        </p>
      )}
    </div>
  );
}
