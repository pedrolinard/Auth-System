"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";

import { CampoSenha } from "@/components/CampoSenha";
import { DesafioTurnstile } from "@/components/DesafioTurnstile";
import { CascaAuth } from "@/components/auth/CascaAuth";
import { AvisoErro } from "@/components/ui/AvisoErro";

type Resposta = {
  redirecionar?: string;
  mfaObrigatorio?: boolean;
  mfaToken?: string;
  erro?: string;
  captchaNecessario?: boolean;
};

async function postar(caminho: string, corpo: Record<string, unknown>): Promise<{ ok: boolean; dados: Resposta }> {
  const resposta = await fetch(caminho, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const dados = (await resposta.json().catch(() => ({}))) as Resposta;
  return { ok: resposta.ok, dados };
}

/**
 * Tela do login hospedado. Não cria sessão no provedor: ao entrar, o servidor
 * devolve a URL de retorno da aplicação com o código de autorização, e o
 * navegador vai pra lá.
 */
export function LoginHospedado({ pedido, nomeAplicacao }: { pedido: string; nomeAplicacao: string }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [usandoBackup, setUsandoBackup] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [precisaCaptcha, setPrecisaCaptcha] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [tentativaCaptcha, setTentativaCaptcha] = useState(0);

  function tratar({ ok, dados }: { ok: boolean; dados: Resposta }) {
    if (ok && dados.redirecionar) {
      window.location.assign(dados.redirecionar);
      return;
    }
    if (ok && dados.mfaObrigatorio && dados.mfaToken) {
      setMfaToken(dados.mfaToken);
      return;
    }
    if (dados.captchaNecessario) {
      setPrecisaCaptcha(true);
      setTurnstileToken(null);
      setTentativaCaptcha((n) => n + 1);
    }
    setErro(dados.erro ?? "Não foi possível entrar agora.");
  }

  async function aoEntrar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      tratar(await postar("/api/oidc/entrar", { pedido, email, senha, turnstileToken: turnstileToken ?? undefined }));
    } catch {
      setErro("Sem conexão com o servidor. Tente de novo.");
    } finally {
      setCarregando(false);
    }
  }

  async function aoVerificar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      tratar(await postar("/api/oidc/mfa", { pedido, mfaToken, codigo, tipo: usandoBackup ? "backup" : "codigo" }));
    } catch {
      setErro("Sem conexão com o servidor. Tente de novo.");
    } finally {
      setCarregando(false);
    }
  }

  if (mfaToken) {
    const codigoBackupCompleto = codigo.replace("-", "").length === 10;
    return (
      <CascaAuth
        titulo="Só falta o código"
        descricao={
          usandoBackup
            ? "Digite um dos códigos de backup que você guardou."
            : "Abra seu aplicativo autenticador e digite os 6 dígitos."
        }
      >
        <form onSubmit={aoVerificar} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="codigo" className="text-sm text-zinc-600 dark:text-zinc-400">
              {usandoBackup ? "Código de backup" : "Código"}
            </label>
            {usandoBackup ? (
              <input
                key="codigo-backup"
                id="codigo"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={11}
                required
                autoFocus
                placeholder="XXXXX-XXXXX"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
                className="input-field text-center font-mono text-lg tracking-[0.2em]"
              />
            ) : (
              <input
                key="codigo-totp"
                id="codigo"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                autoFocus
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
                className="input-field text-center font-mono text-lg tracking-[0.5em]"
              />
            )}
          </div>

          <AvisoErro>{erro}</AvisoErro>

          <button
            type="submit"
            disabled={carregando || (usandoBackup ? !codigoBackupCompleto : codigo.length !== 6)}
            className="btn-primary mt-1"
          >
            {carregando ? "Verificando..." : "Verificar"}
          </button>

          <button
            type="button"
            onClick={() => {
              setUsandoBackup((atual) => !atual);
              setCodigo("");
              setErro(null);
            }}
            className="link-underline self-center text-sm text-zinc-600 dark:text-zinc-400"
          >
            {usandoBackup ? "Usar o aplicativo autenticador" : "Perdi o autenticador — usar um código de backup"}
          </button>
        </form>
      </CascaAuth>
    );
  }

  return (
    <CascaAuth
      titulo={`Entrar em ${nomeAplicacao}`}
      descricao="Use o e-mail e a senha da sua conta. Depois você volta automaticamente para o aplicativo."
    >
      <form onSubmit={aoEntrar} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm text-zinc-600 dark:text-zinc-400">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-field"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="senha" className="text-sm text-zinc-600 dark:text-zinc-400">
            Senha
          </label>
          <CampoSenha id="senha" value={senha} onChange={setSenha} autoComplete="current-password" />
        </div>

        {precisaCaptcha && <DesafioTurnstile key={tentativaCaptcha} onToken={setTurnstileToken} />}

        <AvisoErro>{erro}</AvisoErro>

        <button
          type="submit"
          disabled={carregando || (precisaCaptcha && !turnstileToken)}
          className="btn-primary group mt-1"
        >
          {carregando ? "Entrando..." : "Entrar"}
          {!carregando && (
            <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          )}
        </button>
      </form>
    </CascaAuth>
  );
}
