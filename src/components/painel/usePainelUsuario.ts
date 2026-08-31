"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { obterUsuarioAtual } from "@/lib/clienteAuth";

export type UsuarioPainel = {
  id: string;
  nome: string;
  email: string;
  criadoEm: string;
  mfaAtivado: boolean;
  emailVerificado: boolean;
  papel: "usuario" | "admin";
};

// Guarda compartilhada das telas do painel que exigem o usuário carregado
// (visão geral, conta, segurança): busca única em /me no mount, redireciona
// pra /login se não autenticado. As telas de projetos/usuários/auditoria não
// usam isto porque já falham nas próprias chamadas de API quando sem sessão.
export function usePainelUsuario() {
  const router = useRouter();
  const [usuario, setUsuario] = useState<UsuarioPainel | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let ativo = true;
    obterUsuarioAtual()
      .then((atual) => {
        if (!ativo) return;
        if (!atual) {
          router.replace("/login");
          return;
        }
        setUsuario(atual as UsuarioPainel);
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [router]);

  return { usuario, setUsuario, carregando };
}
