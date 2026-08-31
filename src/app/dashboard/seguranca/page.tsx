"use client";

import { useRouter } from "next/navigation";
import {
  SecaoMfa,
  SecaoPasskeys,
  SecaoSessoes,
  SecaoTrocarSenha,
} from "@/components/painel/segurancaSecoes";
import { usePainelUsuario } from "@/components/painel/usePainelUsuario";

export default function PaginaSeguranca() {
  const router = useRouter();
  const { usuario, setUsuario, carregando } = usePainelUsuario();

  if (carregando) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-zinc-600 dark:text-zinc-400">Carregando...</p>
      </div>
    );
  }

  if (!usuario) return null;

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-6 py-10">
      <div className="flex w-full max-w-lg flex-col gap-1">
        <span className="eyebrow text-zinc-500 dark:text-zinc-500">Segurança</span>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Segurança da conta
        </h1>
      </div>

      <SecaoTrocarSenha />

      <SecaoMfa
        mfaAtivado={usuario.mfaAtivado}
        aoMudarStatus={(ativado) =>
          setUsuario((atual) => (atual ? { ...atual, mfaAtivado: ativado } : atual))
        }
      />

      <SecaoPasskeys />

      <SecaoSessoes aoRevogarAtual={() => router.replace("/login")} />
    </div>
  );
}
