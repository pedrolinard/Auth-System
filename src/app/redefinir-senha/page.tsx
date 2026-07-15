"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { redefinirSenha } from "@/lib/clienteAuth";
import { CampoSenha } from "@/components/CampoSenha";
import { Marca } from "@/components/Marca";

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
    <div className="card-surface flex w-full max-w-sm flex-col gap-5 p-8">
      <Marca className="h-6 w-6 text-foreground" />
      <div className="flex flex-col gap-1.5">
        <span className="eyebrow text-zinc-500 dark:text-zinc-500">Auth Gateway</span>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Redefinir senha
        </h1>
      </div>

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
          <Link href="/login" className="link-underline self-center text-sm font-medium text-foreground">
            Ir para o login
          </Link>
        </>
      )}

      {token && !sucesso && (
        <form onSubmit={aoEnviar} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
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

          <button type="submit" disabled={carregando} className="btn-primary mt-1">
            {carregando ? "Redefinindo..." : "Redefinir senha"}
          </button>
        </form>
      )}
    </div>
  );
}

export default function PaginaRedefinirSenha() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <Suspense
        fallback={<p className="text-zinc-600 dark:text-zinc-400">Carregando...</p>}
      >
        <ConteudoRedefinicao />
      </Suspense>
    </div>
  );
}
