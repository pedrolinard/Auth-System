"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { obterUsuarioAtual, type UsuarioAtual } from "@/lib/clienteAuth";

// Reexportado com o nome antigo — só pra não quebrar quem já importava daqui
// (o tipo de verdade vive junto de obterUsuarioAtual em clienteAuth.ts).
export type UsuarioPainel = UsuarioAtual;

// Guarda compartilhada das telas do painel que exigem o usuário carregado
// (visão geral, conta, segurança): busca única em /me no mount, redireciona
// pra /login se não autenticado. As telas de projetos/usuários/auditoria não
// usam isto porque já falham nas próprias chamadas de API quando sem sessão.
export function usePainelUsuario() {
  const router = useRouter();
  const [usuario, setUsuario] = useState<UsuarioAtual | null>(null);
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
        setUsuario(atual);
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
