"use client";

import { useState } from "react";
import { MailCheck } from "lucide-react";
import { solicitarRecuperacaoSenha } from "@/lib/clienteAuth";
import { CascaAuth, LinkAuth } from "@/components/auth/CascaAuth";
import { AvisoErro } from "@/components/ui/AvisoErro";

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

  if (enviado) {
    return (
      <CascaAuth
        titulo="Confira seu e-mail"
        centralizado
        rodape={<LinkAuth href="/login">Voltar para o login</LinkAuth>}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent-wash)] text-[var(--accent)]">
            <MailCheck className="h-6 w-6" strokeWidth={2} />
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Se <span className="font-medium text-foreground">{email}</span> tiver uma conta,
            o link de redefinição já está a caminho. Dê uma olhada também no spam.
          </p>
        </div>
      </CascaAuth>
    );
  }

  return (
    <CascaAuth
      titulo="Esqueci minha senha"
      descricao="Digite o e-mail da conta e enviamos um link pra criar uma nova."
      rodape={<LinkAuth href="/login">Voltar para o login</LinkAuth>}
    >
      <form onSubmit={aoEnviar} className="flex flex-col gap-5">
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

        <AvisoErro>{erro}</AvisoErro>

        <button type="submit" disabled={carregando} className="btn-primary mt-1">
          {carregando ? "Enviando..." : "Enviar link de redefinição"}
        </button>
      </form>
    </CascaAuth>
  );
}
