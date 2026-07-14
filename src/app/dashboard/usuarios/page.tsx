"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listarUsuarios, type UsuarioAdmin } from "@/lib/clienteAuth";

export default function PaginaUsuarios() {
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    listarUsuarios()
      .then(setUsuarios)
      .catch((erroCapturado) => {
        setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
      });
  }, []);

  return (
    <div className="flex flex-1 flex-col items-center gap-6 bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <div className="flex w-full max-w-3xl flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Usuários</h1>
          <Link href="/dashboard" className="text-sm text-zinc-600 underline dark:text-zinc-400">
            Voltar ao dashboard
          </Link>
        </div>

        {erro && (
          <div className="rounded-xl border border-black/[.08] bg-white p-6 text-sm text-red-600 dark:border-white/[.145] dark:bg-zinc-950 dark:text-red-400">
            {erro}
          </div>
        )}

        {!erro && usuarios === null && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Carregando...</p>
        )}

        {usuarios && (
          <div className="overflow-x-auto rounded-xl border border-black/[.08] bg-white dark:border-white/[.145] dark:bg-zinc-950">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/[.08] text-xs uppercase tracking-wide text-zinc-500 dark:border-white/[.145] dark:text-zinc-400">
                  <th className="px-4 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium">E-mail</th>
                  <th className="px-4 py-3 font-medium">Papel</th>
                  <th className="px-4 py-3 font-medium">Cadastrado em</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((usuario) => (
                  <tr
                    key={usuario.id}
                    className="border-b border-black/[.06] last:border-0 dark:border-white/[.08]"
                  >
                    <td className="px-4 py-3 text-black dark:text-zinc-50">{usuario.nome}</td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{usuario.email}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          usuario.papel === "admin"
                            ? "rounded-full bg-black/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-black dark:bg-white/10 dark:text-white"
                            : "text-xs text-zinc-500 dark:text-zinc-400"
                        }
                      >
                        {usuario.papel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {new Date(usuario.criadoEm).toLocaleString("pt-BR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {usuarios.length === 0 && (
              <p className="p-4 text-sm text-zinc-600 dark:text-zinc-400">Nenhum usuário ainda.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
