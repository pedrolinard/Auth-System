"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { verificarEmail } from "@/lib/clienteAuth";
import { CascaAuth, LinkAuth } from "@/components/auth/CascaAuth";
import { IconeEstado } from "@/components/ui/IconeEstado";

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

  const mensagem = semToken
    ? "Esse link de verificação está incompleto."
    : estado === "carregando"
      ? "Conferindo o link..."
      : estado === "sucesso"
        ? "E-mail verificado. Sua conta está completa."
        : mensagemErro;

  return (
    <CascaAuth
      titulo="Verificação de e-mail"
      centralizado
      rodape={<LinkAuth href="/dashboard">Ir para o painel</LinkAuth>}
    >
      <div className="flex flex-col items-center gap-3">
        <IconeEstado estado={semToken ? "erro" : estado} />
        <p
          className={
            !semToken && estado === "sucesso"
              ? "text-sm text-foreground"
              : "text-sm text-zinc-600 dark:text-zinc-400"
          }
        >
          {mensagem}
        </p>
      </div>
    </CascaAuth>
  );
}

export default function PaginaVerificarEmail() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center px-6 py-16">
          <p className="text-zinc-600 dark:text-zinc-400">Carregando...</p>
        </div>
      }
    >
      <ConteudoVerificacao />
    </Suspense>
  );
}
