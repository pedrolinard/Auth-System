"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cadastrar, ErroCaptchaNecessario } from "@/lib/clienteAuth";
import { CampoSenha } from "@/components/CampoSenha";
import { DesafioTurnstile } from "@/components/DesafioTurnstile";
import { Marca } from "@/components/Marca";

export default function PaginaCadastro() {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  // Mesmo padrão de src/app/login/page.tsx: widget só aparece depois que o
  // servidor recusa por falta de CAPTCHA, e `tentativaCaptcha` força um token
  // novo a cada tentativa reprovada.
  const [precisaCaptcha, setPrecisaCaptcha] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [tentativaCaptcha, setTentativaCaptcha] = useState(0);

  async function aoEnviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      await cadastrar({ nome, email, senha, turnstileToken: turnstileToken ?? undefined });
      router.push("/login");
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

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <form
        onSubmit={aoEnviar}
        className="card-surface flex w-full max-w-sm flex-col gap-5 p-8"
      >
        <Marca className="h-6 w-6 text-foreground" />
        <div className="flex flex-col gap-1.5">
          <span className="eyebrow text-zinc-500 dark:text-zinc-500">Auth Gateway</span>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Criar conta</h1>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="nome" className="text-sm text-zinc-600 dark:text-zinc-400">
            Nome
          </label>
          <input
            id="nome"
            name="nome"
            required
            autoFocus
            autoComplete="name"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="input-field"
          />
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
            autoComplete="new-password"
            minLength={8}
          />
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
          {carregando ? "Enviando..." : "Cadastrar"}
        </button>

        <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
          Já tem conta?{" "}
          <Link href="/login" className="link-underline font-medium text-foreground">
            Entrar
          </Link>
        </p>
      </form>
    </div>
  );
}
