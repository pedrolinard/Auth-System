"use client";

import { useState } from "react";
import Link from "next/link";
import { solicitarRecuperacaoSenha } from "@/lib/clienteAuth";

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
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 font-sans dark:bg-black">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-black/[.08] bg-white p-8 dark:border-white/[.145] dark:bg-zinc-950">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">
          Esqueci minha senha
        </h1>

        {enviado ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Se esse e-mail estiver cadastrado, um link de redefinição foi enviado.
          </p>
        ) : (
          <form onSubmit={aoEnviar} className="flex flex-col gap-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Digite o e-mail da sua conta e enviaremos um link para redefinir a senha.
            </p>

            <div className="flex flex-col gap-1">
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
                className="rounded-md border border-black/[.08] px-3 py-2 text-sm dark:border-white/[.145] dark:bg-black"
              />
            </div>

            {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

            <button
              type="submit"
              disabled={carregando}
              className="mt-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
            >
              {carregando ? "Enviando..." : "Enviar link de redefinição"}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
          <Link href="/login" className="font-medium text-black dark:text-zinc-50">
            Voltar para o login
          </Link>
        </p>
      </div>
    </div>
  );
}
