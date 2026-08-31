"use client";

import { useCallback, useEffect, useState } from "react";
import { listarAuditoria, type RegistroAuditoria } from "@/lib/clienteAuth";

export default function PaginaAuditoria() {
  const [registros, setRegistros] = useState<RegistroAuditoria[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtroEvento, setFiltroEvento] = useState("");
  const [filtroEmail, setFiltroEmail] = useState("");

  const carregar = useCallback(async (evento: string, email: string) => {
    try {
      setRegistros(await listarAuditoria({ evento: evento || undefined, email: email || undefined }));
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar("", "");
  }, [carregar]);

  function aoFiltrar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setRegistros(null);
    carregar(filtroEvento.trim(), filtroEmail.trim());
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-6 py-10">
      <div className="flex w-full max-w-4xl flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="eyebrow text-zinc-500 dark:text-zinc-500">Admin</span>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Auditoria</h1>
        </div>

        <form onSubmit={aoFiltrar} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="filtroEvento" className="text-xs text-zinc-600 dark:text-zinc-400">
              Evento
            </label>
            <input
              id="filtroEvento"
              value={filtroEvento}
              onChange={(e) => setFiltroEvento(e.target.value)}
              placeholder="ex.: login_falha"
              className="input-field text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="filtroEmail" className="text-xs text-zinc-600 dark:text-zinc-400">
              E-mail
            </label>
            <input
              id="filtroEmail"
              value={filtroEmail}
              onChange={(e) => setFiltroEmail(e.target.value)}
              className="input-field text-sm"
            />
          </div>
          <button type="submit" className="btn-secondary-sm">
            Filtrar
          </button>
        </form>

        {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

        {registros === null && !erro && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Carregando...</p>
        )}

        {registros && (
          <div className="card-surface overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/[.08] text-xs uppercase tracking-wide text-zinc-500 dark:border-white/[.1] dark:text-zinc-500">
                  <th className="px-4 py-3 font-medium">Quando</th>
                  <th className="px-4 py-3 font-medium">Evento</th>
                  <th className="px-4 py-3 font-medium">E-mail</th>
                  <th className="px-4 py-3 font-medium">Admin responsável</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                  <th className="px-4 py-3 font-medium">User-Agent</th>
                </tr>
              </thead>
              <tbody>
                {registros.map((registro) => (
                  <tr
                    key={registro.id}
                    className="border-b border-black/[.05] align-top last:border-0 dark:border-white/[.06]"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {new Date(registro.criadoEm).toLocaleString("pt-BR")}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">{registro.evento}</td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {registro.email ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {registro.autorEmail ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {registro.ip ?? "—"}
                    </td>
                    <td className="max-w-[280px] truncate px-4 py-3 text-xs text-zinc-500 dark:text-zinc-500">
                      {registro.userAgent ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {registros.length === 0 && (
              <p className="p-4 text-sm text-zinc-600 dark:text-zinc-400">Nenhum registro encontrado.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
