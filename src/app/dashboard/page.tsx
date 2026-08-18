"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import {
  alterarEmail,
  confirmarMfa,
  desativarMfa,
  excluirMinhaConta,
  excluirPasskey,
  exportarMeusDados,
  iniciarMfa,
  listarPasskeys,
  listarSessoes,
  obterUsuarioAtual,
  registrarPasskey,
  reenviarVerificacaoEmail,
  revogarSessao,
  revogarTodasSessoes,
  sair,
  trocarSenha,
  type Passkey,
  type Sessao,
} from "@/lib/clienteAuth";
import { CampoSenha } from "@/components/CampoSenha";

type Usuario = {
  id: string;
  nome: string;
  email: string;
  criadoEm: string;
  mfaAtivado: boolean;
  emailVerificado: boolean;
  papel: "usuario" | "admin";
};

export default function PaginaDashboard() {
  const router = useRouter();
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [reenviando, setReenviando] = useState(false);
  const [reenviado, setReenviado] = useState(false);
  const [erroReenvio, setErroReenvio] = useState<string | null>(null);

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

  async function aoReenviarVerificacao() {
    setErroReenvio(null);
    setReenviando(true);
    try {
      await reenviarVerificacaoEmail();
      setReenviado(true);
    } catch (erroCapturado) {
      setErroReenvio(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setReenviando(false);
    }
  }

  if (carregando) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-zinc-600 dark:text-zinc-400">Carregando...</p>
      </div>
    );
  }

  if (!usuario) return null;

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-6 py-16">
      <div className="card-surface flex w-full max-w-lg flex-col gap-4 p-8">
        <span className="eyebrow text-zinc-500 dark:text-zinc-500">Perfil</span>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Olá, {usuario.nome}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{usuario.email}</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Conta criada em {new Date(usuario.criadoEm).toLocaleString("pt-BR")}
        </p>
        <p
          className={
            usuario.emailVerificado
              ? "text-sm text-green-600 dark:text-green-400"
              : "text-sm text-amber-600 dark:text-amber-400"
          }
        >
          {usuario.emailVerificado ? "E-mail verificado" : "E-mail não verificado"}
        </p>

        {!usuario.emailVerificado && (
          <div className="flex flex-col gap-1">
            {reenviado ? (
              <p className="text-sm text-green-600 dark:text-green-400">
                Link de verificação enviado. Confira sua caixa de entrada.
              </p>
            ) : (
              <button
                onClick={aoReenviarVerificacao}
                disabled={reenviando}
                className="link-underline self-start text-sm text-zinc-600 disabled:opacity-50 dark:text-zinc-400"
              >
                {reenviando ? "Enviando..." : "Reenviar e-mail de verificação"}
              </button>
            )}
            {erroReenvio && (
              <p className="text-sm text-red-600 dark:text-red-400">{erroReenvio}</p>
            )}
          </div>
        )}

        <div className="mt-2 flex flex-wrap gap-2">
          <Link href="/dashboard/projetos" className="btn-primary">
            Meus projetos
          </Link>
          {usuario.papel === "admin" && (
            <>
              <Link href="/dashboard/usuarios" className="btn-secondary">
                Usuários
              </Link>
              <Link href="/dashboard/auditoria" className="btn-secondary">
                Auditoria
              </Link>
            </>
          )}
          <button onClick={aoSair} className="btn-secondary">
            Sair
          </button>
        </div>
      </div>

      <SecaoAlterarEmail />

      <SecaoTrocarSenha />

      <SecaoMfa
        mfaAtivado={usuario.mfaAtivado}
        aoMudarStatus={(ativado) =>
          setUsuario((atual) => (atual ? { ...atual, mfaAtivado: ativado } : atual))
        }
      />

      <SecaoPasskeys />

      <SecaoSessoes
        aoRevogarAtual={() => {
          router.replace("/login");
        }}
      />

      <SecaoDadosDaConta
        aoExcluirConta={() => {
          router.replace("/login");
        }}
      />
    </div>
  );
}

function SecaoAlterarEmail() {
  const [novoEmail, setNovoEmail] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [carregando, setCarregando] = useState(false);

  async function aoEnviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setSucesso(false);
    setCarregando(true);
    try {
      await alterarEmail(novoEmail);
      setSucesso(true);
      setNovoEmail("");
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="card-surface flex w-full max-w-lg flex-col gap-4 p-8">
      <span className="eyebrow text-zinc-500 dark:text-zinc-500">Conta</span>
      <h2 className="text-lg font-semibold tracking-tight text-foreground">Alterar e-mail</h2>

      <form onSubmit={aoEnviar} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="novoEmail" className="text-sm text-zinc-600 dark:text-zinc-400">
            Novo e-mail
          </label>
          <input
            id="novoEmail"
            name="novoEmail"
            type="email"
            required
            value={novoEmail}
            onChange={(e) => setNovoEmail(e.target.value)}
            className="input-field"
          />
        </div>

        {sucesso && (
          <p className="text-sm text-green-600 dark:text-green-400">
            Enviamos um link de confirmação pro novo endereço. O e-mail da conta só muda
            depois que ele for confirmado.
          </p>
        )}
        {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

        <button
          type="submit"
          disabled={carregando || !novoEmail}
          className="btn-primary-sm self-start"
        >
          {carregando ? "Enviando..." : "Pedir troca de e-mail"}
        </button>
      </form>
    </div>
  );
}

function SecaoTrocarSenha() {
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [carregando, setCarregando] = useState(false);

  async function aoTrocarSenha(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setSucesso(false);
    setCarregando(true);
    try {
      await trocarSenha({ senhaAtual, novaSenha });
      setSucesso(true);
      setSenhaAtual("");
      setNovaSenha("");
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="card-surface flex w-full max-w-lg flex-col gap-4 p-8">
      <span className="eyebrow text-zinc-500 dark:text-zinc-500">Segurança</span>
      <h2 className="text-lg font-semibold tracking-tight text-foreground">Trocar senha</h2>

      <form onSubmit={aoTrocarSenha} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="senhaAtual" className="text-sm text-zinc-600 dark:text-zinc-400">
            Senha atual
          </label>
          <CampoSenha
            id="senhaAtual"
            value={senhaAtual}
            onChange={setSenhaAtual}
            autoComplete="current-password"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="novaSenha" className="text-sm text-zinc-600 dark:text-zinc-400">
            Nova senha
          </label>
          <CampoSenha
            id="novaSenha"
            value={novaSenha}
            onChange={setNovaSenha}
            autoComplete="new-password"
          />
        </div>

        {sucesso && (
          <p className="text-sm text-green-600 dark:text-green-400">
            Senha alterada. Suas outras sessões foram encerradas.
          </p>
        )}
        {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

        <button
          type="submit"
          disabled={carregando || !senhaAtual || !novaSenha}
          className="btn-primary-sm self-start"
        >
          {carregando ? "Trocando..." : "Trocar senha"}
        </button>
      </form>
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
    <div className="card-surface flex w-full max-w-lg flex-col gap-4 p-8">
      <span className="eyebrow text-zinc-500 dark:text-zinc-500">Segurança</span>
      <h2 className="text-lg font-semibold tracking-tight text-foreground">
        Verificação em duas etapas
      </h2>

      {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

      {!mfaAtivado && !configurando && (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Desativada. Ative para exigir um código do seu aplicativo autenticador a cada login.
          </p>
          <button onClick={aoIniciarAtivacao} disabled={carregando} className="btn-primary self-start">
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
            className="h-40 w-40 self-center rounded-lg border border-black/[.08] dark:border-white/[.13]"
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
            className="input-field text-center font-mono text-lg tracking-[0.5em]"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={carregando || codigo.length !== 6} className="btn-primary-sm">
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
              className="btn-secondary-sm"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {mfaAtivado && !desativando && (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Ativada.</p>
          <button onClick={() => setDesativando(true)} className="btn-secondary self-start">
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
            className="input-field text-center font-mono text-lg tracking-[0.5em]"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={carregando || codigo.length !== 6}
              className="inline-flex items-center justify-center rounded-full bg-red-600 px-4 py-1.5 text-xs font-medium text-white transition-all duration-150 hover:-translate-y-px hover:bg-red-700 active:translate-y-0 active:scale-[.97] disabled:pointer-events-none disabled:opacity-50"
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
              className="btn-secondary-sm"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function SecaoDadosDaConta({ aoExcluirConta }: { aoExcluirConta: () => void }) {
  const [exportando, setExportando] = useState(false);
  const [erroExportar, setErroExportar] = useState<string | null>(null);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [senha, setSenha] = useState("");
  const [excluindo, setExcluindo] = useState(false);
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);

  async function aoExportar() {
    setErroExportar(null);
    setExportando(true);
    try {
      const dados = await exportarMeusDados();
      const blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "meus-dados.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (erroCapturado) {
      setErroExportar(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setExportando(false);
    }
  }

  async function aoConfirmarExclusao(evento: React.FormEvent) {
    evento.preventDefault();
    setErroExcluir(null);
    setExcluindo(true);
    try {
      await excluirMinhaConta(senha);
      aoExcluirConta();
    } catch (erroCapturado) {
      setErroExcluir(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <div className="card-surface flex w-full max-w-lg flex-col gap-4 p-8">
      <span className="eyebrow text-zinc-500 dark:text-zinc-500">Conta</span>
      <h2 className="text-lg font-semibold tracking-tight text-foreground">Meus dados</h2>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Baixe uma cópia de tudo que guardamos sobre a sua conta (perfil, sessões, dispositivos
          confiáveis e histórico de segurança).
        </p>
        {erroExportar && <p className="text-sm text-red-600 dark:text-red-400">{erroExportar}</p>}
        <button onClick={aoExportar} disabled={exportando} className="btn-secondary self-start">
          {exportando ? "Exportando..." : "Exportar meus dados"}
        </button>
      </div>

      <div className="flex flex-col gap-2 border-t border-black/[.08] pt-4 dark:border-white/[.1]">
        <h3 className="text-sm font-medium text-red-600 dark:text-red-400">Excluir conta</h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Remove permanentemente sua conta e todos os dados associados. Essa ação não pode ser
          desfeita.
        </p>

        {!confirmandoExclusao && (
          <button
            onClick={() => setConfirmandoExclusao(true)}
            className="self-start rounded-full border border-red-600/30 px-4 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-600/10 dark:text-red-400"
          >
            Excluir minha conta
          </button>
        )}

        {confirmandoExclusao && (
          <form onSubmit={aoConfirmarExclusao} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="senhaExcluirConta" className="text-sm text-zinc-600 dark:text-zinc-400">
                Digite sua senha atual para confirmar
              </label>
              <CampoSenha
                id="senhaExcluirConta"
                value={senha}
                onChange={setSenha}
                autoComplete="current-password"
              />
            </div>
            {erroExcluir && <p className="text-sm text-red-600 dark:text-red-400">{erroExcluir}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={excluindo || !senha}
                className="inline-flex items-center justify-center rounded-full bg-red-600 px-4 py-1.5 text-xs font-medium text-white transition-all duration-150 hover:-translate-y-px hover:bg-red-700 active:translate-y-0 active:scale-[.97] disabled:pointer-events-none disabled:opacity-50"
              >
                {excluindo ? "Excluindo..." : "Confirmar exclusão permanente"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmandoExclusao(false);
                  setSenha("");
                  setErroExcluir(null);
                }}
                className="btn-secondary-sm"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function SecaoPasskeys() {
  const [suportaPasskey, setSuportaPasskey] = useState(false);
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [adicionando, setAdicionando] = useState(false);
  const [removendoId, setRemovendoId] = useState<string | null>(null);
  const [nomeNovaPasskey, setNomeNovaPasskey] = useState("");

  const carregar = useCallback(async () => {
    try {
      setPasskeys(await listarPasskeys());
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSuportaPasskey(browserSupportsWebAuthn());
    carregar();
  }, [carregar]);

  async function aoAdicionar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setAdicionando(true);
    try {
      await registrarPasskey(nomeNovaPasskey.trim() || undefined);
      setNomeNovaPasskey("");
      await carregar();
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setAdicionando(false);
    }
  }

  async function aoRemover(passkey: Passkey) {
    setErro(null);
    setRemovendoId(passkey.id);
    try {
      await excluirPasskey(passkey.id);
      await carregar();
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setRemovendoId(null);
    }
  }

  if (!suportaPasskey) return null;

  return (
    <div className="card-surface flex w-full max-w-lg flex-col gap-4 p-8">
      <span className="eyebrow text-zinc-500 dark:text-zinc-500">Segurança</span>
      <h2 className="text-lg font-semibold tracking-tight text-foreground">Passkeys</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Entre sem digitar senha usando biometria, PIN do dispositivo ou uma chave de segurança —
        resistente a phishing. Sua senha continua funcionando normalmente.
      </p>

      {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

      {passkeys === null && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Carregando...</p>
      )}

      {passkeys && passkeys.length === 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Nenhuma passkey cadastrada.</p>
      )}

      {passkeys && passkeys.length > 0 && (
        <ul className="flex flex-col gap-3">
          {passkeys.map((passkey) => (
            <li
              key={passkey.id}
              className="flex flex-col gap-2 rounded-lg border border-black/[.06] bg-black/[.02] p-3 sm:flex-row sm:items-center sm:justify-between dark:border-white/[.06] dark:bg-white/[.03]"
            >
              <div className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                <span className="font-medium text-foreground">{passkey.nome || "Passkey sem nome"}</span>
                <span>Criada em {new Date(passkey.criadoEm).toLocaleString("pt-BR")}</span>
                <span>
                  {passkey.ultimoUsoEm
                    ? `Último uso em ${new Date(passkey.ultimoUsoEm).toLocaleString("pt-BR")}`
                    : "Nunca usada"}
                </span>
              </div>
              <button
                onClick={() => aoRemover(passkey)}
                disabled={removendoId === passkey.id}
                className="btn-secondary-sm shrink-0 self-start sm:self-auto"
              >
                {removendoId === passkey.id ? "Removendo..." : "Remover"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={aoAdicionar} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="nomeNovaPasskey" className="text-sm text-zinc-600 dark:text-zinc-400">
            Apelido (opcional)
          </label>
          <input
            id="nomeNovaPasskey"
            value={nomeNovaPasskey}
            onChange={(e) => setNomeNovaPasskey(e.target.value)}
            placeholder="ex.: Touch ID do MacBook"
            className="input-field text-sm"
          />
        </div>
        <button type="submit" disabled={adicionando} className="btn-primary-sm">
          {adicionando ? "Adicionando..." : "Adicionar passkey"}
        </button>
      </form>
    </div>
  );
}

const ROTULO_DISPOSITIVO: Record<Sessao["tipoDispositivo"], string> = {
  desktop: "Computador",
  mobile: "Celular",
  tablet: "Tablet",
  desconhecido: "Dispositivo desconhecido",
};

function SecaoSessoes({ aoRevogarAtual }: { aoRevogarAtual: () => void }) {
  const [sessoes, setSessoes] = useState<Sessao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [revogandoId, setRevogandoId] = useState<string | null>(null);
  const [revogandoTodas, setRevogandoTodas] = useState(false);

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

  async function aoRevogarTodas() {
    setErro(null);
    setRevogandoTodas(true);
    try {
      await revogarTodasSessoes();
      aoRevogarAtual();
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setRevogandoTodas(false);
    }
  }

  return (
    <div className="card-surface flex w-full max-w-lg flex-col gap-4 p-8">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="eyebrow text-zinc-500 dark:text-zinc-500">Segurança</span>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Sessões ativas</h2>
        </div>
        {sessoes && sessoes.length > 0 && (
          <button
            onClick={aoRevogarTodas}
            disabled={revogandoTodas}
            className="shrink-0 rounded-full border border-red-600/30 px-3 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-600/10 disabled:opacity-50 dark:text-red-400"
          >
            {revogandoTodas ? "Saindo..." : "Sair de todos os dispositivos"}
          </button>
        )}
      </div>

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
              className="flex flex-col gap-3 rounded-lg border border-black/[.06] bg-black/[.02] p-3 sm:flex-row sm:items-center sm:justify-between dark:border-white/[.06] dark:bg-white/[.03]"
            >
              <div className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-foreground">
                    {ROTULO_DISPOSITIVO[sessao.tipoDispositivo]}
                  </span>
                  <span>{sessao.localizacao ?? "Localização desconhecida"}</span>
                  {sessao.atual && (
                    <span className="whitespace-nowrap rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-black dark:bg-white/10 dark:text-white">
                      sessão atual
                    </span>
                  )}
                </div>
                <span>Criada em {new Date(sessao.criadoEm).toLocaleString("pt-BR")}</span>
                <span>Expira em {new Date(sessao.expiraEm).toLocaleString("pt-BR")}</span>
              </div>
              <button
                onClick={() => aoRevogar(sessao)}
                disabled={revogandoId === sessao.id}
                className="btn-secondary-sm shrink-0 self-start sm:self-auto"
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
