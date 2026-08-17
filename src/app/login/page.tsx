"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { entrar, ErroCaptchaNecessario, verificarMfaLogin } from "@/lib/clienteAuth";
import { CampoSenha } from "@/components/CampoSenha";
import { DesafioTurnstile } from "@/components/DesafioTurnstile";
import { Marca } from "@/components/Marca";

export default function PaginaLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [lembrarDispositivo, setLembrarDispositivo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

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
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <form
          onSubmit={aoEnviarCodigoMfa}
          className="card-surface flex w-full max-w-sm flex-col gap-5 p-8"
        >
          <Marca className="h-6 w-6 text-foreground" />
          <div className="flex flex-col gap-1.5">
            <span className="eyebrow text-zinc-500 dark:text-zinc-500">Passo 2 de 2</span>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Verificação em duas etapas
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Digite o código de 6 dígitos do seu aplicativo autenticador.
            </p>
          </div>

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
              className="h-4 w-4 rounded border-black/[.2] dark:border-white/[.2]"
            />
            Lembrar este dispositivo por 30 dias
          </label>

          {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

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
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <form
        onSubmit={aoEnviarCredenciais}
        className="card-surface flex w-full max-w-sm flex-col gap-5 p-8"
      >
        <Marca className="h-6 w-6 text-foreground" />
        <div className="flex flex-col gap-1.5">
          <span className="eyebrow text-zinc-500 dark:text-zinc-500">Auth Gateway</span>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Entrar</h1>
        </div>

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

        {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

        <button
          type="submit"
          disabled={carregando || (precisaCaptcha && !turnstileToken)}
          className="btn-primary mt-1"
        >
          {carregando ? "Entrando..." : "Entrar"}
        </button>

        <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
          Ainda não tem conta?{" "}
          <Link href="/cadastro" className="link-underline font-medium text-foreground">
            Criar conta
          </Link>
        </p>
      </form>
    </div>
  );
}
