"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { confirmarAlteracaoEmail } from "@/lib/clienteAuth";
import { CascaAuth, LinkAuth } from "@/components/auth/CascaAuth";
import { IconeEstado } from "@/components/ui/IconeEstado";

function ConteudoConfirmacao() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [estado, setEstado] = useState<"carregando" | "sucesso" | "erro">(
    "carregando",
  );
  const [novoEmail, setNovoEmail] = useState<string | null>(null);
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    confirmarAlteracaoEmail(token)
      .then((email) => {
        setNovoEmail(email);
        setEstado("sucesso");
      })
      .catch((erro) => {
        setEstado("erro");
        setMensagemErro(erro instanceof Error ? erro.message : "Erro inesperado.");
      });
  }, [token]);

  const semToken = !token;

  return (
    <CascaAuth
      titulo="Confirmação de e-mail"
      centralizado
      rodape={<LinkAuth href="/dashboard">Ir para o painel</LinkAuth>}
    >
      <div className="flex flex-col items-center gap-3">
        <IconeEstado estado={semToken ? "erro" : estado} />
        {semToken && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Esse link de confirmação está incompleto.
          </p>
        )}
        {!semToken && estado === "carregando" && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Confirmando a troca...</p>
        )}
        {!semToken && estado === "sucesso" && (
          <p className="text-sm text-foreground">
            Pronto — o e-mail da conta agora é{" "}
            <span className="font-medium">{novoEmail}</span>.
          </p>
        )}
        {!semToken && estado === "erro" && (
          <p className="text-sm text-red-600 dark:text-red-400">{mensagemErro}</p>
        )}
      </div>
    </CascaAuth>
  );
}

export default function PaginaConfirmarAlteracaoEmail() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center px-6 py-16">
          <p className="text-zinc-600 dark:text-zinc-400">Carregando...</p>
        </div>
      }
    >
      <ConteudoConfirmacao />
    </Suspense>
  );
}
