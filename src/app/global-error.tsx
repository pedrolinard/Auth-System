"use client";

import { useEffect } from "react";
import Rollbar from "rollbar";
import { configCliente } from "@/lib/rollbar";

export default function ErroGlobal({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // O layout raiz (e o RollbarProvider dele) não está disponível aqui —
    // é justamente o que quebrou — então precisa de uma instância própria.
    const rollbar = new Rollbar(configCliente);
    rollbar.error(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
        <div>
          <h1 className="text-lg font-semibold">Algo deu muito errado</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            O erro já foi registrado. Tente recarregar a página.
          </p>
        </div>
      </body>
    </html>
  );
}
