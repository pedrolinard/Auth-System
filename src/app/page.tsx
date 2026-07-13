import Link from "next/link";

export default function PaginaInicial() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 px-6 text-center font-sans dark:bg-black">
      <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
        Sistema de Autenticação Intermediária
      </h1>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">
        Cadastro, login e geração de tokens de acesso e atualização (JWT),
        servindo como gateway de autenticação para outras aplicações.
      </p>
      <div className="flex gap-4">
        <Link
          href="/login"
          className="rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
        >
          Entrar
        </Link>
        <Link
          href="/cadastro"
          className="rounded-full border border-black/[.08] px-5 py-3 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
        >
          Criar conta
        </Link>
      </div>
    </div>
  );
}
