"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Fingerprint } from "lucide-react";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { entrar, entrarComPasskey, ErroCaptchaNecessario, verificarMfaLogin } from "@/lib/clienteAuth";
import { CampoSenha } from "@/components/CampoSenha";
import { DesafioTurnstile } from "@/components/DesafioTurnstile";
import { CascaAuth, LinkAuth } from "@/components/auth/CascaAuth";
import { AvisoErro } from "@/components/ui/AvisoErro";

export default function PaginaLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [lembrarDispositivo, setLembrarDispositivo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const [suportaPasskey, setSuportaPasskey] = useState(false);
  const [entrandoComPasskey, setEntrandoComPasskey] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSuportaPasskey(browserSupportsWebAuthn());
  }, []);

  async function aoEntrarComPasskey() {
    setErro(null);
    setEntrandoComPasskey(true);
    try {
      await entrarComPasskey();
      router.push("/dashboard");
      router.refresh();
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setEntrandoComPasskey(false);
    }
  }

  // Só aparece depois que o servidor recusa por falta de CAPTCHA
  // (`captchaNecessario`) — fricção progressiva, ver src/app/api/auth/login.
  // `tentativaCaptcha` muda a cada tentativa reprovada pra remontar o widget
  // e pedir um token novo (o do Turnstile é de uso único).
  const [precisaCaptcha, setPrecisaCaptcha] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [tentativaCaptcha, setTentativaCaptcha] = useState(0);

  async function aoEnviarCredenciais(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      const resultado = await entrar({
        email,
        senha,
        turnstileToken: turnstileToken ?? undefined,
      });
      if (resultado.mfaObrigatorio) {
        setMfaToken(resultado.mfaToken);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (erroCapturado) {
      if (erroCapturado instanceof ErroCaptchaNecessario) {
        setPrecisaCaptcha(true);
        setTurnstileToken(null);
        setTentativaCaptcha((n) => n + 1);
      }
      setErro(
        erroCapturado instanceof Error
          ? erroCapturado.message
          : "Erro inesperado.",
      );
    } finally {
      setCarregando(false);
    }
  }

  async function aoEnviarCodigoMfa(evento: React.FormEvent) {
    evento.preventDefault();
    if (!mfaToken) return;
    setErro(null);
    setCarregando(true);
    try {
      await verificarMfaLogin({ mfaToken, codigo, lembrarDispositivo });
      router.push("/dashboard");
      router.refresh();
    } catch (erroCapturado) {
      setErro(
        erroCapturado instanceof Error
          ? erroCapturado.message
          : "Erro inesperado.",
      );
    } finally {
      setCarregando(false);
    }
  }

  if (mfaToken) {
    return (
      <CascaAuth
        titulo="Só falta o código"
        descricao="Passo 2 de 2 — abra seu aplicativo autenticador e digite os 6 dígitos."
      >
        <form onSubmit={aoEnviarCodigoMfa} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="codigo" className="text-sm text-zinc-600 dark:text-zinc-400">
              Código
            </label>
            <input
              id="codigo"
              name="codigo"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
              className="input-field text-center font-mono text-lg tracking-[0.5em]"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={lembrarDispositivo}
              onChange={(e) => setLembrarDispositivo(e.target.checked)}
              className="h-4 w-4 rounded border-black/[.2] accent-[var(--accent)] dark:border-white/[.2]"
            />
            Confiar neste dispositivo por 30 dias
          </label>

          <AvisoErro>{erro}</AvisoErro>

          <button type="submit" disabled={carregando || codigo.length !== 6} className="btn-primary mt-1">
            {carregando ? "Verificando..." : "Verificar"}
          </button>

          <button
            type="button"
            onClick={() => {
              setMfaToken(null);
              setCodigo("");
              setErro(null);
            }}
            className="link-underline self-center text-sm text-zinc-600 dark:text-zinc-400"
          >
            Voltar
          </button>
        </form>
      </CascaAuth>
    );
  }

  return (
    <CascaAuth
      titulo="Entrar"
      descricao="Que bom te ver de novo. Use e-mail e senha, ou uma passkey."
      rodape={
        <>
          Ainda não tem conta? <LinkAuth href="/cadastro">Criar conta</LinkAuth>
        </>
      }
    >
      <form onSubmit={aoEnviarCredenciais} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm text-zinc-600 dark:text-zinc-400">
            E-mail
          </label>
          <input
            id="email"
            name="email"
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
          <CampoSenha
            id="senha"
            value={senha}
            onChange={setSenha}
            autoComplete="current-password"
          />
          <Link
            href="/esqueci-senha"
            className="link-underline self-end text-xs text-zinc-600 dark:text-zinc-400"
          >
            Esqueci minha senha
          </Link>
        </div>

        {precisaCaptcha && (
          <DesafioTurnstile key={tentativaCaptcha} onToken={setTurnstileToken} />
        )}

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

        {suportaPasskey && (
          <>
            <div className="flex items-center gap-3 text-xs text-zinc-400 dark:text-zinc-600">
              <span className="h-px flex-1 bg-black/[.08] dark:bg-white/[.1]" />
              ou
              <span className="h-px flex-1 bg-black/[.08] dark:bg-white/[.1]" />
            </div>
            <button
              type="button"
              onClick={aoEntrarComPasskey}
              disabled={entrandoComPasskey}
              className="btn-secondary"
            >
              <Fingerprint className="mr-1.5 h-4 w-4" />
              {entrandoComPasskey ? "Aguardando o dispositivo..." : "Entrar com uma passkey"}
            </button>
          </>
        )}
      </form>
    </CascaAuth>
  );
}
