"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { verificarEmail } from "@/lib/clienteAuth";
import { Marca } from "@/components/Marca";

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
    <div className="card-surface flex w-full max-w-sm flex-col items-center gap-5 p-8 text-center">
      <Marca className="h-6 w-6 text-foreground" />
      <div className="flex flex-col items-center gap-1.5">
        <span className="eyebrow text-zinc-500 dark:text-zinc-500">Auth Gateway</span>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Verificação de e-mail
        </h1>
      </div>

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

      <Link href="/dashboard" className="link-underline text-sm font-medium text-foreground">
        Ir para o dashboard
      </Link>
    </div>
  );
}

export default function PaginaVerificarEmail() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <Suspense
        fallback={<p className="text-zinc-600 dark:text-zinc-400">Carregando...</p>}
      >
        <ConteudoVerificacao />
      </Suspense>
    </div>
  );
}
