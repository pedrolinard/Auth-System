import { redirect } from "next/navigation";

import { CascaAuth } from "@/components/auth/CascaAuth";
import { LoginHospedado } from "@/components/auth/LoginHospedado";
import { validarPedidoAutorizacao } from "@/lib/oidc";

// Ponto de entrada do login hospedado (OpenID Connect): a aplicação cliente
// manda o navegador pra cá. Tudo é validado no servidor antes de qualquer
// coisa aparecer na tela — com redirect_uri inválido, o erro fica NESTA página
// e nada é redirecionado (senão o provedor viraria redirecionador aberto).
export default async function PaginaAutorizar(props: PageProps<"/autorizar">) {
  const bruto = await props.searchParams;
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(bruto)) {
    // Parâmetro repetido chega como lista e é ambíguo (qual redirect_uri
    // vale?): conta como ausente.
    if (typeof valor === "string") params.set(chave, valor);
  }

  const resultado = await validarPedidoAutorizacao(params);

  if (resultado.tipo === "erro_redirect") {
    redirect(resultado.url);
  }

  if (resultado.tipo === "erro_pagina") {
    return (
      <CascaAuth titulo="Não foi possível entrar" descricao={resultado.mensagem}>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Volte para o aplicativo e tente de novo. Se o problema continuar, avise o suporte dele.
        </p>
      </CascaAuth>
    );
  }

  return (
    <LoginHospedado
      pedido={resultado.pedidoAssinado}
      nomeAplicacao={resultado.aplicacao.nome}
    />
  );
}
