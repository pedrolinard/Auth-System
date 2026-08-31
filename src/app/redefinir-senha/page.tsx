"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { redefinirSenha } from "@/lib/clienteAuth";
import { CampoSenha } from "@/components/CampoSenha";
import { CascaAuth, LinkAuth } from "@/components/auth/CascaAuth";
import { AvisoErro } from "@/components/ui/AvisoErro";
import { IconeEstado } from "@/components/ui/IconeEstado";
import { MedidorForcaSenha } from "@/components/ui/MedidorForcaSenha";

function ConteudoRedefinicao() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [novaSenha, setNovaSenha] = useState("");
  const [sucesso, setSucesso] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function aoEnviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!token) return;
    setErro(null);
    setCarregando(true);
    try {
      await redefinirSenha(token, novaSenha);
      setSucesso(true);
    } catch (erroCapturado) {
      setErro(
        erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.",
      );
    } finally {
      setCarregando(false);
    }
  }

  if (!token) {
    return (
      <CascaAuth titulo="Redefinir senha" centralizado rodape={<LinkAuth href="/esqueci-senha">Pedir um link novo</LinkAuth>}>
        <div className="flex flex-col items-center gap-3">
          <IconeEstado estado="erro" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Esse link está incompleto. Peça outro na tela de recuperação.
          </p>
        </div>
      </CascaAuth>
    );
  }

  if (sucesso) {
    return (
      <CascaAuth titulo="Senha redefinida" centralizado rodape={<LinkAuth href="/login">Ir para o login</LinkAuth>}>
        <div className="flex flex-col items-center gap-3">
          <IconeEstado estado="sucesso" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Pronto. Encerramos todas as sessões antigas por segurança — entre de novo
            com a senha nova.
          </p>
        </div>
      </CascaAuth>
    );
  }

  return (
    <CascaAuth titulo="Redefinir senha" descricao="Escolha uma senha nova pra sua conta.">
      <form onSubmit={aoEnviar} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor="novaSenha" className="text-sm text-zinc-600 dark:text-zinc-400">
            Nova senha
          </label>
          <CampoSenha
            id="novaSenha"
            value={novaSenha}
            onChange={setNovaSenha}
            autoComplete="new-password"
            minLength={8}
          />
          <MedidorForcaSenha senha={novaSenha} />
        </div>

        <AvisoErro>{erro}</AvisoErro>

        <button type="submit" disabled={carregando} className="btn-primary mt-1">
          {carregando ? "Redefinindo..." : "Redefinir senha"}
        </button>
      </form>
    </CascaAuth>
  );
}

export default function PaginaRedefinirSenha() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center px-6 py-16">
          <p className="text-zinc-600 dark:text-zinc-400">Carregando...</p>
        </div>
      }
    >
      <ConteudoRedefinicao />
    </Suspense>
  );
}
