"use client";

import { useCallback, useEffect, useState } from "react";
import { FileDown, ScrollText, Search } from "lucide-react";
import { listarAuditoria, type RegistroAuditoria } from "@/lib/clienteAuth";
import { exportarAuditoriaPdf } from "@/lib/exportarAuditoriaPdf";
import { CabecalhoSecao } from "@/components/ui/CabecalhoSecao";
import { AvisoErro } from "@/components/ui/AvisoErro";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import { Skeleton } from "@/components/ui/Skeleton";
import { notificar } from "@/components/ui/Toaster";

// Cor do "chip" do evento pela intenção que o nome carrega — sem tabela
// exaustiva, só heurística: falha/erro/bloqueio em vermelho, o resto neutro.
function corEvento(evento: string) {
  if (/falha|erro|bloq|inval|recus|suspens|exclu/i.test(evento)) {
    return "bg-red-500/10 text-red-600 dark:text-red-400";
  }
  if (/sucesso|login|cadastro|verific|ativ|criad/i.test(evento)) {
    return "bg-[var(--accent-wash)] text-[var(--accent)]";
  }
  return "bg-black/[.05] text-zinc-600 dark:bg-white/[.06] dark:text-zinc-300";
}

const ATALHOS = ["login", "login_falha", "cadastro", "senha", "mfa"];

export default function PaginaAuditoria() {
  const [registros, setRegistros] = useState<RegistroAuditoria[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtroEvento, setFiltroEvento] = useState("");
  const [filtroEmail, setFiltroEmail] = useState("");
  const [exportando, setExportando] = useState(false);

  async function aoExportarPdf() {
    if (!registros || registros.length === 0) return;
    setExportando(true);
    try {
      await exportarAuditoriaPdf(registros, {
        evento: filtroEvento.trim() || undefined,
        email: filtroEmail.trim() || undefined,
      });
    } catch (erroCapturado) {
      notificar.erro(
        erroCapturado instanceof Error ? erroCapturado.message : "Não deu pra gerar o PDF.",
      );
    } finally {
      setExportando(false);
    }
  }

  const carregar = useCallback(async (evento: string, email: string) => {
    setErro(null);
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
    setRegistros(null);
    carregar(filtroEvento.trim(), filtroEmail.trim());
  }

  function aplicarAtalho(evento: string) {
    setFiltroEvento(evento);
    setRegistros(null);
    carregar(evento, filtroEmail.trim());
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-6 py-10">
      <div className="flex w-full max-w-4xl flex-col gap-4">
        <CabecalhoSecao
          icone={ScrollText}
          eyebrow="Admin"
          titulo="Auditoria"
          descricao="Os eventos de segurança mais recentes — login, cadastro, troca de senha, ações de admin."
          acao={
            <button
              onClick={aoExportarPdf}
              disabled={exportando || !registros || registros.length === 0}
              className="btn-secondary-sm gap-1.5"
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
              {exportando ? "Gerando..." : "Exportar PDF"}
            </button>
          }
        />

        <form onSubmit={aoFiltrar} className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
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
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="filtroEmail" className="text-xs text-zinc-600 dark:text-zinc-400">
                E-mail
              </label>
              <input
                id="filtroEmail"
                value={filtroEmail}
                onChange={(e) => setFiltroEmail(e.target.value)}
                placeholder="alguem@exemplo.com"
                className="input-field text-sm"
              />
            </div>
            <button type="submit" className="btn-secondary-sm">
              Filtrar
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-zinc-400 dark:text-zinc-600">Atalhos:</span>
            {ATALHOS.map((atalho) => (
              <button
                key={atalho}
                type="button"
                onClick={() => aplicarAtalho(atalho)}
                className={`rounded-full px-2 py-0.5 font-mono text-xs transition-colors ${
                  filtroEvento === atalho
                    ? "bg-[var(--accent-wash)] text-[var(--accent)]"
                    : "bg-black/[.04] text-zinc-500 hover:text-foreground dark:bg-white/[.05] dark:text-zinc-400"
                }`}
              >
                {atalho}
              </button>
            ))}
            {(filtroEvento || filtroEmail) && (
              <button
                type="button"
                onClick={() => {
                  setFiltroEvento("");
                  setFiltroEmail("");
                  setRegistros(null);
                  carregar("", "");
                }}
                className="btn-ghost"
              >
                Limpar
              </button>
            )}
          </div>
        </form>

        <AvisoErro>{erro}</AvisoErro>

        {registros === null && !erro && (
          <div className="card-surface flex flex-col gap-3 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        )}

        {registros && registros.length === 0 && (
          <EstadoVazio
            icone={Search}
            titulo="Nenhum registro"
            descricao="Nenhum evento bate com esse filtro. Tente outro termo ou limpe a busca."
          />
        )}

        {registros && registros.length > 0 && (
          <div className="card-surface overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
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
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-md px-1.5 py-0.5 font-mono text-xs ${corEvento(registro.evento)}`}
                      >
                        {registro.evento}
                      </span>
                    </td>
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
          </div>
        )}
      </div>
    </div>
  );
}
