"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  excluirUsuario,
  listarUsuarios,
  obterUsuarioAtual,
  reativarUsuario,
  suspenderUsuario,
  type UsuarioAdmin,
} from "@/lib/clienteAuth";

const DURACOES = [
  { rotulo: "1 dia", dias: 1 },
  { rotulo: "7 dias", dias: 7 },
  { rotulo: "30 dias", dias: 30 },
];

function statusSuspensao(usuario: UsuarioAdmin): string | null {
  if (!usuario.suspensoAtivo) return null;
  return usuario.suspensoAte
    ? `Suspenso até ${new Date(usuario.suspensoAte).toLocaleDateString("pt-BR")}`
    : "Suspenso permanentemente";
}

export default function PaginaUsuarios() {
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[] | null>(null);
  const [meuId, setMeuId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [suspendendoId, setSuspendendoId] = useState<string | null>(null);
  const [processandoId, setProcessandoId] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  async function carregar() {
    try {
      const [lista, eu] = await Promise.all([listarUsuarios(), obterUsuarioAtual()]);
      setUsuarios(lista);
      setMeuId(eu?.id ?? null);
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar();
  }, []);

  async function aoSuspender(id: string, dias: number | undefined) {
    setErro(null);
    setProcessandoId(id);
    try {
      await suspenderUsuario(id, { dias, motivo: motivo.trim() || undefined });
      setSuspendendoId(null);
      setMotivo("");
      await carregar();
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setProcessandoId(null);
    }
  }

  async function aoReativar(id: string) {
    setErro(null);
    setProcessandoId(id);
    try {
      await reativarUsuario(id);
      await carregar();
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setProcessandoId(null);
    }
  }

  async function aoExcluir(id: string, email: string) {
    if (!window.confirm(`Excluir permanentemente a conta de ${email}? Essa ação não pode ser desfeita.`)) {
      return;
    }
    setErro(null);
    setProcessandoId(id);
    try {
      await excluirUsuario(id);
      await carregar();
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setProcessandoId(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-6 py-16">
      <div className="flex w-full max-w-4xl flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="eyebrow text-zinc-500 dark:text-zinc-500">Admin</span>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Usuários</h1>
          </div>
          <Link href="/dashboard" className="link-underline text-sm text-zinc-600 dark:text-zinc-400">
            Voltar ao dashboard
          </Link>
        </div>

        {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

        {usuarios === null && !erro && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Carregando...</p>
        )}

        {usuarios && (
          <div className="card-surface overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-black/[.08] text-xs uppercase tracking-wide text-zinc-500 dark:border-white/[.1] dark:text-zinc-500">
                  <th className="px-4 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium">E-mail</th>
                  <th className="px-4 py-3 font-medium">Papel</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((usuario) => {
                  const status = statusSuspensao(usuario);
                  const ehVoceMesmo = usuario.id === meuId;
                  return (
                    <tr
                      key={usuario.id}
                      className="border-b border-black/[.05] align-top last:border-0 dark:border-white/[.06]"
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
                      <td className="px-4 py-3">
                        {status ? (
                          <span className="text-xs font-medium text-red-600 dark:text-red-400">{status}</span>
                        ) : (
                          <span className="text-xs text-zinc-500 dark:text-zinc-500">Ativo</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {ehVoceMesmo ? (
                          <span className="text-xs text-zinc-400 dark:text-zinc-600">—</span>
                        ) : suspendendoId === usuario.id ? (
                          <div className="flex flex-col gap-2">
                            <input
                              value={motivo}
                              onChange={(e) => setMotivo(e.target.value)}
                              placeholder="Motivo (opcional)"
                              className="input-field text-xs"
                            />
                            <div className="flex flex-wrap gap-1.5">
                              {DURACOES.map(({ rotulo, dias }) => (
                                <button
                                  key={dias}
                                  onClick={() => aoSuspender(usuario.id, dias)}
                                  disabled={processandoId === usuario.id}
                                  className="btn-secondary-sm"
                                >
                                  {rotulo}
                                </button>
                              ))}
                              <button
                                onClick={() => aoSuspender(usuario.id, undefined)}
                                disabled={processandoId === usuario.id}
                                className="inline-flex items-center justify-center rounded-full bg-red-600 px-4 py-1.5 text-xs font-medium text-white transition-all duration-150 hover:-translate-y-px hover:bg-red-700 active:translate-y-0 active:scale-[.97] disabled:pointer-events-none disabled:opacity-50"
                              >
                                Permanente
                              </button>
                              <button
                                onClick={() => {
                                  setSuspendendoId(null);
                                  setMotivo("");
                                }}
                                className="btn-secondary-sm"
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {status ? (
                              <button
                                onClick={() => aoReativar(usuario.id)}
                                disabled={processandoId === usuario.id}
                                className="btn-secondary-sm"
                              >
                                {processandoId === usuario.id ? "..." : "Reativar"}
                              </button>
                            ) : (
                              <button
                                onClick={() => setSuspendendoId(usuario.id)}
                                className="btn-secondary-sm"
                              >
                                Suspender
                              </button>
                            )}
                            <button
                              onClick={() => aoExcluir(usuario.id, usuario.email)}
                              disabled={processandoId === usuario.id}
                              className="inline-flex items-center justify-center rounded-full border border-red-600/30 px-4 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-600/10 disabled:opacity-50 dark:text-red-400"
                            >
                              {processandoId === usuario.id ? "..." : "Excluir"}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
