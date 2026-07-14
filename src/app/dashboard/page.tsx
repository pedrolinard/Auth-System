"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  confirmarMfa,
  desativarMfa,
  iniciarMfa,
  limparTokenAcesso,
  listarSessoes,
  obterTokenAcesso,
  obterUsuarioAtual,
  revogarSessao,
  sair,
  type Sessao,
} from "@/lib/clienteAuth";

type Usuario = {
  id: string;
  nome: string;
  email: string;
  criadoEm: string;
  mfaAtivado: boolean;
};

export default function PaginaDashboard() {
  const router = useRouter();
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregarUsuario = useCallback(async () => {
    const usuarioAtual = await obterUsuarioAtual();
    if (!usuarioAtual) {
      router.replace("/login");
      return null;
    }
    setUsuario(usuarioAtual);
    return usuarioAtual as Usuario;
  }, [router]);

  useEffect(() => {
    // Busca única no mount; o estado de carregamento não deriva de props/state
    // renderizados, então o padrão fetch-on-mount é seguro aqui.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregarUsuario().finally(() => setCarregando(false));
  }, [carregarUsuario]);

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

  if (!usuario) return null;

  return (
    <div className="flex flex-1 flex-col items-center gap-6 bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-xl border border-black/[.08] bg-white p-8 dark:border-white/[.145] dark:bg-zinc-950">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">
          Olá, {usuario.nome}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{usuario.email}</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Conta criada em {new Date(usuario.criadoEm).toLocaleString("pt-BR")}
        </p>

        <div className="mt-2 rounded-md bg-zinc-100 p-3 dark:bg-zinc-900">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Token de acesso atual (JWT)
          </p>
          <p className="mt-1 break-all font-mono text-xs text-zinc-700 dark:text-zinc-300">
            {obterTokenAcesso()}
          </p>
        </div>

        <div className="mt-2 flex gap-2">
          <Link
            href="/dashboard/projetos"
            className="self-start rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            Meus projetos
          </Link>
          <button
            onClick={aoSair}
            className="self-start rounded-full border border-black/[.08] px-5 py-2.5 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
          >
            Sair
          </button>
        </div>
      </div>

      <SecaoMfa
        mfaAtivado={usuario.mfaAtivado}
        aoMudarStatus={(ativado) =>
          setUsuario((atual) => (atual ? { ...atual, mfaAtivado: ativado } : atual))
        }
      />

      <SecaoSessoes
        aoRevogarAtual={() => {
          limparTokenAcesso();
          router.replace("/login");
        }}
      />
    </div>
  );
}

function SecaoMfa({
  mfaAtivado,
  aoMudarStatus,
}: {
  mfaAtivado: boolean;
  aoMudarStatus: (ativado: boolean) => void;
}) {
  const [configurando, setConfigurando] = useState(false);
  const [desativando, setDesativando] = useState(false);
  const [dadosSetup, setDadosSetup] = useState<{
    qrCodeDataUrl: string;
    segredo: string;
  } | null>(null);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function aoIniciarAtivacao() {
    setErro(null);
    setCarregando(true);
    try {
      const dados = await iniciarMfa();
      setDadosSetup(dados);
      setConfigurando(true);
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setCarregando(false);
    }
  }

  async function aoConfirmar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      await confirmarMfa(codigo);
      aoMudarStatus(true);
      setConfigurando(false);
      setDadosSetup(null);
      setCodigo("");
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setCarregando(false);
    }
  }

  async function aoDesativar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      await desativarMfa(codigo);
      aoMudarStatus(false);
      setDesativando(false);
      setCodigo("");
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="flex w-full max-w-lg flex-col gap-4 rounded-xl border border-black/[.08] bg-white p-8 dark:border-white/[.145] dark:bg-zinc-950">
      <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
        Verificação em duas etapas
      </h2>

      {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

      {!mfaAtivado && !configurando && (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Desativada. Ative para exigir um código do seu aplicativo autenticador a cada login.
          </p>
          <button
            onClick={aoIniciarAtivacao}
            disabled={carregando}
            className="self-start rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {carregando ? "Gerando..." : "Ativar"}
          </button>
        </>
      )}

      {!mfaAtivado && configurando && dadosSetup && (
        <form onSubmit={aoConfirmar} className="flex flex-col gap-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Escaneie o QR code com Google Authenticator, Authy ou 1Password e digite o código gerado.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={dadosSetup.qrCodeDataUrl}
            alt="QR code para configurar a verificação em duas etapas"
            className="h-40 w-40 self-center"
          />
          <p className="break-all text-center font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {dadosSetup.segredo}
          </p>
          <input
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            className="rounded-md border border-black/[.08] px-3 py-2 text-center text-lg tracking-[0.5em] dark:border-white/[.145] dark:bg-black"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={carregando || codigo.length !== 6}
              className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
            >
              {carregando ? "Confirmando..." : "Confirmar"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfigurando(false);
                setDadosSetup(null);
                setCodigo("");
                setErro(null);
              }}
              className="rounded-full border border-black/[.08] px-5 py-2.5 text-sm font-medium dark:border-white/[.145]"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {mfaAtivado && !desativando && (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Ativada.</p>
          <button
            onClick={() => setDesativando(true)}
            className="self-start rounded-full border border-black/[.08] px-5 py-2.5 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
          >
            Desativar
          </button>
        </>
      )}

      {mfaAtivado && desativando && (
        <form onSubmit={aoDesativar} className="flex flex-col gap-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Digite o código atual do seu aplicativo autenticador para confirmar a desativação.
          </p>
          <input
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            className="rounded-md border border-black/[.08] px-3 py-2 text-center text-lg tracking-[0.5em] dark:border-white/[.145] dark:bg-black"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={carregando || codigo.length !== 6}
              className="rounded-full bg-red-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {carregando ? "Desativando..." : "Confirmar desativação"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDesativando(false);
                setCodigo("");
                setErro(null);
              }}
              className="rounded-full border border-black/[.08] px-5 py-2.5 text-sm font-medium dark:border-white/[.145]"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function SecaoSessoes({ aoRevogarAtual }: { aoRevogarAtual: () => void }) {
  const [sessoes, setSessoes] = useState<Sessao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [revogandoId, setRevogandoId] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setSessoes(await listarSessoes());
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar();
  }, [carregar]);

  async function aoRevogar(sessao: Sessao) {
    setErro(null);
    setRevogandoId(sessao.id);
    try {
      await revogarSessao(sessao.id);
      if (sessao.atual) {
        aoRevogarAtual();
        return;
      }
      await carregar();
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setRevogandoId(null);
    }
  }

  return (
    <div className="flex w-full max-w-lg flex-col gap-4 rounded-xl border border-black/[.08] bg-white p-8 dark:border-white/[.145] dark:bg-zinc-950">
      <h2 className="text-lg font-semibold text-black dark:text-zinc-50">Sessões ativas</h2>

      {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

      {sessoes === null && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Carregando...</p>
      )}

      {sessoes?.length === 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Nenhuma sessão ativa.</p>
      )}

      {sessoes && sessoes.length > 0 && (
        <ul className="flex flex-col gap-3">
          {sessoes.map((sessao) => (
            <li
              key={sessao.id}
              className="flex items-center justify-between gap-3 rounded-md bg-zinc-100 p-3 dark:bg-zinc-900"
            >
              <div className="text-xs text-zinc-600 dark:text-zinc-400">
                <p>
                  Criada em {new Date(sessao.criadoEm).toLocaleString("pt-BR")}
                  {sessao.atual && (
                    <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-black dark:bg-white/10 dark:text-white">
                      sessão atual
                    </span>
                  )}
                </p>
                <p>Expira em {new Date(sessao.expiraEm).toLocaleString("pt-BR")}</p>
              </div>
              <button
                onClick={() => aoRevogar(sessao)}
                disabled={revogandoId === sessao.id}
                className="shrink-0 rounded-full border border-black/[.08] px-4 py-1.5 text-xs font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
              >
                {revogandoId === sessao.id ? "Revogando..." : "Revogar"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
