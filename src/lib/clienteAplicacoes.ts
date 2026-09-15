"use client";

import { cabecalhoCsrf, lerCorpo, mensagemErro, tentarAtualizarToken } from "./clienteAuth";

export type Aplicacao = {
  id: string;
  nome: string;
  clientId: string;
  origens: string[];
  passkeyRpId: string | null;
  redirectUris: string[];
  emailRemetente: string | null;
  urlLinks: string | null;
  logoUrl: string | null;
  ativa: boolean;
  padrao: boolean;
  aprovada: boolean;
  desativadaPeloOperador: boolean;
  criadoEm: string;
  atualizadoEm: string;
  temSegredo: boolean;
  totalUsuarios: number;
};

export type DadosAplicacao = {
  nome: string;
  origens: string[];
  passkeyRpId: string | null;
  redirectUris: string[];
  // Só quem opera o provedor define; no self-service o campo nem é enviado.
  emailRemetente?: string | null;
  urlLinks: string | null;
  logoUrl: string | null;
};

// Mesmo padrão de requisicaoAutenticada em clienteOrganizacao.ts — CSRF
// automático em mutações, uma tentativa de renovação em 401.
async function requisicaoAutenticada(
  caminho: string,
  opcoes: RequestInit = {},
  tentouRenovar = false,
): Promise<Response> {
  const metodo = (opcoes.method ?? "GET").toUpperCase();
  const precisaCsrf = metodo !== "GET" && metodo !== "HEAD";

  const resposta = await fetch(caminho, {
    ...opcoes,
    headers: {
      ...(opcoes.headers ?? {}),
      ...(precisaCsrf ? cabecalhoCsrf() : {}),
    },
    credentials: "include",
  });

  if (resposta.status === 401 && !tentouRenovar) {
    const renovado = await tentarAtualizarToken();
    if (renovado) return requisicaoAutenticada(caminho, opcoes, true);
  }

  return resposta;
}

export async function listarAplicacoes(): Promise<Aplicacao[]> {
  const resposta = await requisicaoAutenticada("/api/auth/aplicacoes");
  const corpo = await lerCorpo(resposta);
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao carregar aplicações."));
  return corpo.aplicacoes;
}

export async function criarAplicacao(
  dados: DadosAplicacao,
): Promise<{ aplicacao: Aplicacao; clientSecret: string }> {
  const resposta = await requisicaoAutenticada("/api/auth/aplicacoes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados),
  });
  const corpo = await lerCorpo(resposta);
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao criar aplicação."));
  return corpo;
}

export async function atualizarAplicacao(
  id: string,
  dados: Partial<DadosAplicacao> & { ativa?: boolean; aprovada?: boolean },
): Promise<Aplicacao> {
  const resposta = await requisicaoAutenticada(`/api/auth/aplicacoes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados),
  });
  const corpo = await lerCorpo(resposta);
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao salvar aplicação."));
  return corpo.aplicacao;
}

export async function rotacionarSegredoAplicacao(id: string): Promise<string> {
  const resposta = await requisicaoAutenticada(`/api/auth/aplicacoes/${id}/segredo`, {
    method: "POST",
  });
  const corpo = await lerCorpo(resposta);
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao gerar novo segredo."));
  return corpo.clientSecret;
}
