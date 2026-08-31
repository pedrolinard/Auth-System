"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import {
  excluirUsuario,
  listarUsuarios,
  obterUsuarioAtual,
  reativarUsuario,
  suspenderUsuario,
  type UsuarioAdmin,
} from "@/lib/clienteAuth";
import { CabecalhoSecao } from "@/components/ui/CabecalhoSecao";
import { AvisoErro } from "@/components/ui/AvisoErro";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import { Skeleton } from "@/components/ui/Skeleton";
import { notificar } from "@/components/ui/Toaster";

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
  const [confirmandoExclusaoId, setConfirmandoExclusaoId] = useState<string | null>(null);
  const [processandoId, setProcessandoId] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [busca, setBusca] = useState("");

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

  const filtrados = useMemo(() => {
    if (!usuarios) return null;
    const termo = busca.trim().toLowerCase();
    if (!termo) return usuarios;
    return usuarios.filter(
      (u) => u.nome.toLowerCase().includes(termo) || u.email.toLowerCase().includes(termo),
    );
  }, [usuarios, busca]);

  async function aoSuspender(usuario: UsuarioAdmin, dias: number | undefined) {
    setProcessandoId(usuario.id);
    try {
      await suspenderUsuario(usuario.id, { dias, motivo: motivo.trim() || undefined });
      setSuspendendoId(null);
      setMotivo("");
      await carregar();
      notificar.info(`${usuario.nome} foi suspenso.`);
    } catch (erroCapturado) {
      notificar.erro(
        erroCapturado instanceof Error ? erroCapturado.message : "Não deu pra suspender.",
      );
    } finally {
      setProcessandoId(null);
    }
  }

  async function aoReativar(usuario: UsuarioAdmin) {
    setProcessandoId(usuario.id);
    try {
      await reativarUsuario(usuario.id);
      await carregar();
      notificar.sucesso(`${usuario.nome} foi reativado.`);
    } catch (erroCapturado) {
      notificar.erro(
        erroCapturado instanceof Error ? erroCapturado.message : "Não deu pra reativar.",
      );
    } finally {
      setProcessandoId(null);
    }
  }

  async function aoExcluir(usuario: UsuarioAdmin) {
    setProcessandoId(usuario.id);
    try {
      await excluirUsuario(usuario.id);
      setConfirmandoExclusaoId(null);
      await carregar();
      notificar.info(`A conta de ${usuario.email} foi excluída.`);
    } catch (erroCapturado) {
      notificar.erro(
        erroCapturado instanceof Error ? erroCapturado.message : "Não deu pra excluir a conta.",
      );
    } finally {
      setProcessandoId(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-6 py-10">
      <div className="flex w-full max-w-4xl flex-col gap-4">
        <CabecalhoSecao
          icone={Users}
          eyebrow="Admin"
          titulo="Usuários"
          descricao="Suspenda, reative ou remova contas. Você não aparece com ações sobre si mesmo."
          acao={
            usuarios ? (
              <span className="rounded-full bg-black/[.05] px-2.5 py-1 text-xs font-medium text-zinc-500 tabular-nums dark:bg-white/[.06] dark:text-zinc-400">
                {usuarios.length}
              </span>
            ) : undefined
          }
        />

        <AvisoErro>{erro}</AvisoErro>

        {usuarios && usuarios.length > 0 && (
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
              aria-hidden="true"
            />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou e-mail"
              className="input-field pl-9!"
            />
          </div>
        )}

        {usuarios === null && !erro && (
          <div className="card-surface flex flex-col gap-3 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        )}

        {filtrados && filtrados.length === 0 && (
          <EstadoVazio
            icone={Search}
            titulo={usuarios && usuarios.length > 0 ? "Nada encontrado" : "Nenhum usuário ainda"}
            descricao={
              usuarios && usuarios.length > 0
                ? "Nenhum nome ou e-mail bate com a busca."
                : "As contas cadastradas vão aparecer nesta lista."
            }
          />
        )}

        {filtrados && filtrados.length > 0 && (
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
                {filtrados.map((usuario) => {
                  const status = statusSuspensao(usuario);
                  const ehVoceMesmo = usuario.id === meuId;
                  return (
                    <tr
                      key={usuario.id}
                      className="border-b border-black/[.05] align-top last:border-0 dark:border-white/[.06]"
                    >
                      <td className="px-4 py-3 text-foreground">
                        {usuario.nome}
                        {ehVoceMesmo && (
                          <span className="ml-1.5 rounded-full bg-[var(--accent-wash)] px-1.5 py-0.5 text-[10px] font-medium uppercase text-[var(--accent)]">
                            você
                          </span>
                        )}
                      </td>
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
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
                            {status}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-500">
                            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                            Ativo
                          </span>
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
                                  onClick={() => aoSuspender(usuario, dias)}
                                  disabled={processandoId === usuario.id}
                                  className="btn-secondary-sm"
                                >
                                  {rotulo}
                                </button>
                              ))}
                              <button
                                onClick={() => aoSuspender(usuario, undefined)}
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
                        ) : confirmandoExclusaoId === usuario.id ? (
                          <div className="flex flex-col gap-2">
                            <p className="text-xs text-red-600 dark:text-red-400">
                              Excluir a conta de {usuario.email} de vez?
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                onClick={() => aoExcluir(usuario)}
                                disabled={processandoId === usuario.id}
                                className="inline-flex items-center justify-center rounded-full bg-red-600 px-4 py-1.5 text-xs font-medium text-white transition-all duration-150 hover:-translate-y-px hover:bg-red-700 disabled:pointer-events-none disabled:opacity-50"
                              >
                                {processandoId === usuario.id ? "Excluindo..." : "Sim, excluir"}
                              </button>
                              <button
                                onClick={() => setConfirmandoExclusaoId(null)}
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
                                onClick={() => aoReativar(usuario)}
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
                              onClick={() => setConfirmandoExclusaoId(usuario.id)}
                              disabled={processandoId === usuario.id}
                              className="inline-flex items-center justify-center rounded-full border border-red-600/30 px-4 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-600/10 disabled:opacity-50 dark:text-red-400"
                            >
                              Excluir
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
