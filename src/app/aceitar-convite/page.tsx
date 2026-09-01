"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { obterUsuarioAtual } from "@/lib/clienteAuth";
import { aceitarConvite } from "@/lib/clienteOrganizacao";
import { CascaAuth, LinkAuth } from "@/components/auth/CascaAuth";
import { IconeEstado } from "@/components/ui/IconeEstado";

type Estado = "carregando" | "sucesso" | "erro" | "precisa-entrar";

function ConteudoAceitarConvite() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [estado, setEstado] = useState<Estado>("carregando");
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    // Aceitar exige estar autenticado (ver comentário na rota) — confere
    // antes de tentar, pra distinguir "precisa entrar primeiro" de um erro
    // de verdade (convite inválido/expirado/já usado).
    obterUsuarioAtual().then((usuario) => {
      if (!usuario) {
        setEstado("precisa-entrar");
        return;
      }
      aceitarConvite(token)
        .then(() => setEstado("sucesso"))
        .catch((erro) => {
          setEstado("erro");
          setMensagemErro(erro instanceof Error ? erro.message : "Erro inesperado.");
        });
    });
  }, [token]);

  const semToken = !token;

  if (semToken) {
    return (
      <CascaAuth
        titulo="Convite de organização"
        centralizado
        rodape={<LinkAuth href="/dashboard">Ir para o painel</LinkAuth>}
      >
        <div className="flex flex-col items-center gap-3">
          <IconeEstado estado="erro" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Esse link de convite está incompleto.
          </p>
        </div>
      </CascaAuth>
    );
  }

  if (estado === "precisa-entrar") {
    return (
      <CascaAuth
        titulo="Convite de organização"
        descricao="Entre ou crie uma conta com o e-mail que recebeu o convite — depois volte a este link (ele continua funcionando por 7 dias) para aceitar."
      >
        <div className="flex flex-col gap-2">
          <LinkAuth href="/login">Entrar</LinkAuth>
          <LinkAuth href="/cadastro">Criar conta</LinkAuth>
        </div>
      </CascaAuth>
    );
  }

  const mensagem =
    estado === "carregando"
      ? "Conferindo o convite..."
      : estado === "sucesso"
        ? "Convite aceito. Você já está na organização."
        : mensagemErro;

  return (
    <CascaAuth
      titulo="Convite de organização"
      centralizado
      rodape={<LinkAuth href="/dashboard/organizacoes">Ver minhas organizações</LinkAuth>}
    >
      <div className="flex flex-col items-center gap-3">
        <IconeEstado estado={estado === "carregando" ? "carregando" : estado} />
        <p
          className={
            estado === "sucesso"
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

export default function PaginaAceitarConvite() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center px-6 py-16">
          <p className="text-zinc-600 dark:text-zinc-400">Carregando...</p>
        </div>
      }
    >
      <ConteudoAceitarConvite />
    </Suspense>
  );
}
