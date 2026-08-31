"use client";

import { useRouter } from "next/navigation";
import { SecaoAlterarEmail, SecaoDadosDaConta } from "@/components/painel/contaSecoes";
import { usePainelUsuario } from "@/components/painel/usePainelUsuario";

export default function PaginaConta() {
  const router = useRouter();
  const { usuario, carregando } = usePainelUsuario();

  if (carregando) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-zinc-600 dark:text-zinc-400">Carregando...</p>
      </div>
    );
  }

  if (!usuario) return null;

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-6 py-10">
      <div className="card-surface flex w-full max-w-lg flex-col gap-3 p-8">
        <span className="eyebrow text-zinc-500 dark:text-zinc-500">Conta</span>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Perfil</h1>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500 dark:text-zinc-500">Nome</dt>
            <dd className="text-foreground">{usuario.nome}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500 dark:text-zinc-500">E-mail</dt>
            <dd className="text-right text-zinc-600 dark:text-zinc-400">{usuario.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500 dark:text-zinc-500">Papel</dt>
            <dd className="text-zinc-600 dark:text-zinc-400">{usuario.papel}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500 dark:text-zinc-500">Criada em</dt>
            <dd className="text-right text-zinc-600 dark:text-zinc-400">
              {new Date(usuario.criadoEm).toLocaleString("pt-BR")}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500 dark:text-zinc-500">Verificação</dt>
            <dd
              className={
                usuario.emailVerificado
                  ? "text-green-600 dark:text-green-400"
                  : "text-amber-600 dark:text-amber-400"
              }
            >
              {usuario.emailVerificado ? "E-mail verificado" : "E-mail não verificado"}
            </dd>
          </div>
        </dl>
      </div>

      <SecaoAlterarEmail />

      <SecaoDadosDaConta aoExcluirConta={() => router.replace("/login")} />
    </div>
  );
}
