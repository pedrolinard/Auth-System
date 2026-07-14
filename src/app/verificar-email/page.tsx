"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { verificarEmail } from "@/lib/clienteAuth";

function ConteudoVerificacao() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [estado, setEstado] = useState<"carregando" | "sucesso" | "erro">(
    "carregando",
  );
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    verificarEmail(token)
      .then(() => setEstado("sucesso"))
      .catch((erro) => {
        setEstado("erro");
        setMensagemErro(erro instanceof Error ? erro.message : "Erro inesperado.");
      });
  }, [token]);

  const semToken = !token;

  return (
    <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-black/[.08] bg-white p-8 text-center dark:border-white/[.145] dark:bg-zinc-950">
      <h1 className="text-xl font-semibold text-black dark:text-zinc-50">
        Verificação de e-mail
      </h1>

      {semToken && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Link de verificação incompleto.
        </p>
      )}

      {!semToken && estado === "carregando" && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Verificando...</p>
      )}

      {!semToken && estado === "sucesso" && (
        <p className="text-sm text-green-600 dark:text-green-400">
          E-mail verificado com sucesso.
        </p>
      )}

      {!semToken && estado === "erro" && (
        <p className="text-sm text-red-600 dark:text-red-400">{mensagemErro}</p>
      )}

      <Link href="/dashboard" className="text-sm font-medium text-black dark:text-zinc-50">
        Ir para o dashboard
      </Link>
    </div>
  );
}

export default function PaginaVerificarEmail() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <Suspense
        fallback={<p className="text-zinc-600 dark:text-zinc-400">Carregando...</p>}
      >
        <ConteudoVerificacao />
      </Suspense>
    </div>
  );
}
