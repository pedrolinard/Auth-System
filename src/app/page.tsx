import Link from "next/link";
import { Marca } from "@/components/Marca";

export default function PaginaInicial() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-black/[.08] bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_24px_48px_-28px_rgba(20,19,15,0.3)] dark:border-white/[.13] dark:bg-zinc-900/95 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_24px_48px_-20px_rgba(0,0,0,0.85)]">
        <Marca className="h-8 w-8 text-foreground" />
      </div>
      <div className="flex flex-col items-center gap-2">
        <span className="eyebrow text-zinc-500 dark:text-zinc-500">Auth Gateway</span>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Sistema de Autenticação
        </h1>
      </div>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">
        Cadastro, login e geração de tokens de acesso e atualização (JWT),
        servindo como gateway de autenticação para outras aplicações.
      </p>
      <div className="flex gap-3">
        <Link href="/login" className="btn-primary">
          Entrar
        </Link>
        <Link href="/cadastro" className="btn-secondary">
          Criar conta
        </Link>
      </div>
    </div>
  );
}
