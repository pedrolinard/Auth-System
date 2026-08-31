"use client";

import { useRouter } from "next/navigation";
import { BadgeCheck, MailCheck, MailWarning, UserRound } from "lucide-react";
import { SecaoAlterarEmail, SecaoDadosDaConta } from "@/components/painel/contaSecoes";
import { usePainelUsuario } from "@/components/painel/usePainelUsuario";
import { CabecalhoSecao } from "@/components/ui/CabecalhoSecao";
import { Skeleton } from "@/components/ui/Skeleton";
import { notificar } from "@/components/ui/Toaster";

export default function PaginaConta() {
  const router = useRouter();
  const { usuario, carregando } = usePainelUsuario();

  if (carregando) {
    return (
      <div className="flex flex-1 flex-col items-center gap-6 px-6 py-10">
        <Skeleton className="h-56 w-full max-w-lg rounded-2xl" />
        <Skeleton className="h-48 w-full max-w-lg rounded-2xl" />
      </div>
    );
  }

  if (!usuario) return null;

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-6 py-10">
      <div className="card-surface animate-surgir flex w-full max-w-lg flex-col gap-4 p-8">
        <CabecalhoSecao
          icone={UserRound}
          eyebrow="Conta"
          titulo="Perfil"
          acao={
            usuario.papel === "admin" ? (
              <span className="flex items-center gap-1 rounded-full bg-[var(--accent-wash)] px-2.5 py-1 text-xs font-medium text-[var(--accent)]">
                <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                admin
              </span>
            ) : undefined
          }
        />
        <dl className="flex flex-col divide-y divide-black/[.06] text-sm dark:divide-white/[.07]">
          <div className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-zinc-500 dark:text-zinc-500">Nome</dt>
            <dd className="text-foreground">{usuario.nome}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-zinc-500 dark:text-zinc-500">E-mail</dt>
            <dd className="text-right text-zinc-600 dark:text-zinc-400">{usuario.email}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-zinc-500 dark:text-zinc-500">Na conta desde</dt>
            <dd className="text-right text-zinc-600 dark:text-zinc-400">
              {new Date(usuario.criadoEm).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-zinc-500 dark:text-zinc-500">Verificação</dt>
            <dd>
              {usuario.emailVerificado ? (
                <span className="flex items-center gap-1.5 text-[var(--accent)]">
                  <MailCheck className="h-4 w-4" aria-hidden="true" />
                  E-mail verificado
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <MailWarning className="h-4 w-4" aria-hidden="true" />
                  E-mail não verificado
                </span>
              )}
            </dd>
          </div>
        </dl>
      </div>

      <SecaoAlterarEmail />

      <SecaoDadosDaConta
        aoExcluirConta={() => {
          notificar.info("Sua conta foi excluída.");
          router.replace("/login");
        }}
      />
    </div>
  );
}
