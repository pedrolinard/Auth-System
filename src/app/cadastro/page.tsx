"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cadastrar, ErroCaptchaNecessario } from "@/lib/clienteAuth";
import { CampoSenha } from "@/components/CampoSenha";
import { DesafioTurnstile } from "@/components/DesafioTurnstile";
import { CascaAuth, LinkAuth } from "@/components/auth/CascaAuth";
import { AvisoErro } from "@/components/ui/AvisoErro";
import { MedidorForcaSenha } from "@/components/ui/MedidorForcaSenha";
import { notificar } from "@/components/ui/Toaster";

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
      notificar.sucesso("Conta criada. Agora é só entrar.");
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
    <CascaAuth
      titulo="Criar conta"
      descricao="Leva menos de um minuto. Só precisamos de nome, e-mail e uma senha."
      rodape={
        <>
          Já tem conta? <LinkAuth href="/login">Entrar</LinkAuth>
        </>
      }
    >
      <form onSubmit={aoEnviar} className="flex flex-col gap-5">
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

        <div className="flex flex-col gap-2">
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
          <MedidorForcaSenha senha={senha} />
        </div>

        {precisaCaptcha && (
          <DesafioTurnstile key={tentativaCaptcha} onToken={setTurnstileToken} />
        )}

        <AvisoErro>{erro}</AvisoErro>

        <button
          type="submit"
          disabled={carregando || (precisaCaptcha && !turnstileToken)}
          className="btn-primary mt-1"
        >
          {carregando ? "Enviando..." : "Cadastrar"}
        </button>
      </form>
    </CascaAuth>
  );
}
