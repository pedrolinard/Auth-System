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
    <div className="flex flex-1 flex-col items-center gap-6 px-6 py-16">
      <div className="flex w-full max-w-3xl flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="eyebrow text-zinc-500 dark:text-zinc-500">Admin</span>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Usuários</h1>
          </div>
          <Link href="/dashboard" className="link-underline text-sm text-zinc-600 dark:text-zinc-400">
            Voltar ao dashboard
          </Link>
        </div>

        {erro && (
          <div className="card-surface p-6 text-sm text-red-600 dark:text-red-400">{erro}</div>
        )}

        {!erro && usuarios === null && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Carregando...</p>
        )}

        {usuarios && (
          <div className="card-surface overflow-x-auto p-0">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/[.08] text-xs uppercase tracking-wide text-zinc-500 dark:border-white/[.1] dark:text-zinc-500">
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
                    className="border-b border-black/[.05] last:border-0 dark:border-white/[.06]"
                  >
                    <td className="px-4 py-3 text-foreground">{usuario.nome}</td>
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
