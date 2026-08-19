"use client"; // Error components precisam ser Client Components

import { useEffect } from "react";
import { useRollbar } from "@rollbar/react";

export default function ErroDaRota({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const rollbar = useRollbar();

  useEffect(() => {
    rollbar.error(error);
  }, [error, rollbar]);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
      <div className="card-surface flex w-full flex-col gap-4 p-8">
        <h1 className="text-lg font-semibold text-foreground">Algo deu errado</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          O erro já foi registrado. Você pode tentar de novo.
        </p>
        <button type="button" onClick={reset} className="btn-primary">
          Tentar de novo
        </button>
      </div>
    </div>
  );
}
