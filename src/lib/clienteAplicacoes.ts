"use client";

import { cabecalhoCsrf, lerCorpo, mensagemErro, tentarAtualizarToken } from "./clienteAuth";

export type Aplicacao = {
  id: string;
  nome: string;
  clientId: string;
  origens: string[];
  passkeyRpId: string | null;
  redirectUris: string[];
  clientePublico: boolean;
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
  clientePublico: boolean;
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

export type EntregaWebhook = {
  id: string;
  evento: string;
  tentativas: number;
  entregueEm: string | null;
  desistiuEm: string | null;
  proximaTentativaEm: string;
  ultimoStatus: number | null;
  ultimoErro: string | null;
  criadoEm: string;
};

export type Webhook = {
  id: string;
  url: string;
  eventos: string[];
  ativo: boolean;
  desativadoMotivo: string | null;
  criadoEm: string;
  entregas?: EntregaWebhook[];
};

async function comCorpo<T>(resposta: Response, padrao: string): Promise<T> {
  const corpo = await lerCorpo(resposta);
  if (!resposta.ok) throw new Error(mensagemErro(corpo, padrao));
  return corpo as T;
}

export async function listarWebhooks(aplicacaoId: string) {
  return comCorpo<{ webhooks: Webhook[]; recebeEventos: boolean }>(
    await requisicaoAutenticada(`/api/auth/aplicacoes/${aplicacaoId}/webhooks`),
    "Falha ao carregar webhooks.",
  );
}

export async function criarWebhook(aplicacaoId: string, dados: { url: string; eventos: string[] }) {
  return comCorpo<{ webhook: Webhook; segredo: string }>(
    await requisicaoAutenticada(`/api/auth/aplicacoes/${aplicacaoId}/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    }),
    "Falha ao criar webhook.",
  );
}

export async function atualizarWebhook(aplicacaoId: string, webhookId: string, dados: { ativo?: boolean }) {
  return comCorpo<{ webhook: Webhook }>(
    await requisicaoAutenticada(`/api/auth/aplicacoes/${aplicacaoId}/webhooks/${webhookId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    }),
    "Falha ao salvar webhook.",
  );
}

export async function excluirWebhook(aplicacaoId: string, webhookId: string) {
  await comCorpo(
    await requisicaoAutenticada(`/api/auth/aplicacoes/${aplicacaoId}/webhooks/${webhookId}`, { method: "DELETE" }),
    "Falha ao excluir webhook.",
  );
}

export async function testarWebhook(aplicacaoId: string, webhookId: string) {
  return comCorpo<{ entregue: boolean; status: number | null; erro: string | null }>(
    await requisicaoAutenticada(`/api/auth/aplicacoes/${aplicacaoId}/webhooks/${webhookId}/teste`, { method: "POST" }),
    "Falha ao testar webhook.",
  );
}

export async function rotacionarSegredoWebhook(aplicacaoId: string, webhookId: string) {
  return comCorpo<{ segredo: string }>(
    await requisicaoAutenticada(`/api/auth/aplicacoes/${aplicacaoId}/webhooks/${webhookId}/segredo`, { method: "POST" }),
    "Falha ao gerar novo segredo.",
  );
}

export async function rotacionarSegredoAplicacao(id: string): Promise<string> {
  const resposta = await requisicaoAutenticada(`/api/auth/aplicacoes/${id}/segredo`, {
    method: "POST",
  });
  const corpo = await lerCorpo(resposta);
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao gerar novo segredo."));
  return corpo.clientSecret;
}
