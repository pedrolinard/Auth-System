"use client";

import { useState } from "react";
import Link from "next/link";
import { solicitarRecuperacaoSenha } from "@/lib/clienteAuth";
import { Marca } from "@/components/Marca";

export default function PaginaEsqueciSenha() {
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function aoEnviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      await solicitarRecuperacaoSenha(email);
      setEnviado(true);
    } catch (erroCapturado) {
      setErro(
        erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.",
      );
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="card-surface flex w-full max-w-sm flex-col gap-5 p-8">
        <Marca className="h-6 w-6 text-foreground" />
        <div className="flex flex-col gap-1.5">
          <span className="eyebrow text-zinc-500 dark:text-zinc-500">Auth Gateway</span>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Esqueci minha senha
          </h1>
        </div>

        {enviado ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Se esse e-mail estiver cadastrado, um link de redefinição foi enviado.
          </p>
        ) : (
          <form onSubmit={aoEnviar} className="flex flex-col gap-5">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Digite o e-mail da sua conta e enviaremos um link para redefinir a senha.
            </p>

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

            {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

            <button type="submit" disabled={carregando} className="btn-primary mt-1">
              {carregando ? "Enviando..." : "Enviar link de redefinição"}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
          <Link href="/login" className="link-underline font-medium text-foreground">
            Voltar para o login
          </Link>
        </p>
      </div>
    </div>
  );
}
