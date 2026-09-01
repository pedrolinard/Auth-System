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
  // Papel de SISTEMA (quem opera a instalação inteira — painel de
  // auditoria). Não confundir com papelOrganizacao abaixo, que é o que
  // decide acesso a "Usuários" (gestão de membros).
  papel: "usuario" | "admin";
  organizacaoId: string;
  papelOrganizacao: "dono" | "admin" | "membro";
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
