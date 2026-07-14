"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { redefinirSenha } from "@/lib/clienteAuth";
import { CampoSenha } from "@/components/CampoSenha";

function ConteudoRedefinicao() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [novaSenha, setNovaSenha] = useState("");
  const [sucesso, setSucesso] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function aoEnviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!token) return;
    setErro(null);
    setCarregando(true);
    try {
      await redefinirSenha(token, novaSenha);
      setSucesso(true);
    } catch (erroCapturado) {
      setErro(
        erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.",
      );
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-black/[.08] bg-white p-8 dark:border-white/[.145] dark:bg-zinc-950">
      <h1 className="text-xl font-semibold text-black dark:text-zinc-50">
        Redefinir senha
      </h1>

      {!token && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Link de redefinição incompleto.
        </p>
      )}

      {token && sucesso && (
        <>
          <p className="text-sm text-green-600 dark:text-green-400">
            Senha redefinida com sucesso. Todas as sessões ativas foram encerradas.
          </p>
          <Link
            href="/login"
            className="text-center text-sm font-medium text-black dark:text-zinc-50"
          >
            Ir para o login
          </Link>
        </>
      )}

      {token && !sucesso && (
        <form onSubmit={aoEnviar} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="novaSenha" className="text-sm text-zinc-600 dark:text-zinc-400">
              Nova senha
            </label>
            <CampoSenha
              id="novaSenha"
              value={novaSenha}
              onChange={setNovaSenha}
              autoComplete="new-password"
              minLength={8}
            />
          </div>

          {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

          <button
            type="submit"
            disabled={carregando}
            className="mt-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {carregando ? "Redefinindo..." : "Redefinir senha"}
          </button>
        </form>
      )}
    </div>
  );
}

export default function PaginaRedefinirSenha() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <Suspense
        fallback={<p className="text-zinc-600 dark:text-zinc-400">Carregando...</p>}
      >
        <ConteudoRedefinicao />
      </Suspense>
    </div>
  );
}
