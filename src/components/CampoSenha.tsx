"use client";

import { useState } from "react";

export function CampoSenha({
  id,
  value,
  onChange,
  autoComplete,
  minLength,
}: {
  id: string;
  value: string;
  onChange: (valor: string) => void;
  autoComplete?: string;
  minLength?: number;
}) {
  const [visivel, setVisivel] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        name={id}
        type={visivel ? "text" : "password"}
        required
        minLength={minLength}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-black/[.08] px-3 py-2 pr-14 text-sm dark:border-white/[.145] dark:bg-black"
      />
      <button
        type="button"
        onClick={() => setVisivel((atual) => !atual)}
        aria-label={visivel ? "Ocultar senha" : "Mostrar senha"}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        {visivel ? "Ocultar" : "Mostrar"}
      </button>
    </div>
  );
}
