"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  obterTokenAcesso,
  obterUsuarioAtual,
  sair,
} from "@/lib/clienteAuth";

type Usuario = {
  id: string;
  nome: string;
  email: string;
  criadoEm: string;
};

export default function PaginaDashboard() {
  const router = useRouter();
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    obterUsuarioAtual().then((usuarioAtual) => {
      if (!usuarioAtual) {
        router.replace("/login");
        return;
      }
      setUsuario(usuarioAtual);
      setCarregando(false);
    });
  }, [router]);

  async function aoSair() {
    await sair();
    router.replace("/login");
  }

  if (carregando) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
        <p className="text-zinc-600 dark:text-zinc-400">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-xl border border-black/[.08] bg-white p-8 dark:border-white/[.145] dark:bg-zinc-950">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">
          Olá, {usuario?.nome}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {usuario?.email}
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Conta criada em{" "}
          {usuario && new Date(usuario.criadoEm).toLocaleString("pt-BR")}
        </p>

        <div className="mt-2 rounded-md bg-zinc-100 p-3 dark:bg-zinc-900">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Token de acesso atual (JWT)
          </p>
          <p className="mt-1 break-all font-mono text-xs text-zinc-700 dark:text-zinc-300">
            {obterTokenAcesso()}
          </p>
        </div>

        <button
          onClick={aoSair}
          className="mt-2 self-start rounded-full border border-black/[.08] px-5 py-2.5 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
        >
          Sair
        </button>
      </div>
    </div>
  );
}
