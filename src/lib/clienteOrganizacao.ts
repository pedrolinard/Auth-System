"use client";

import { cabecalhoCsrf, mensagemErro, tentarAtualizarToken } from "./clienteAuth";

export type Organizacao = {
  id: string;
  nome: string;
  slug: string;
  papel: "dono" | "admin" | "membro";
};

export type ConviteOrganizacao = {
  id: string;
  email: string;
  papel: "dono" | "admin" | "membro";
  aceitoEm: string | null;
  criadoEm: string;
};

// Mesmo padrão de requisicaoAutenticada em clienteDominio.ts — CSRF
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

export async function listarOrganizacoes(): Promise<Organizacao[]> {
  const resposta = await requisicaoAutenticada("/api/auth/organizacoes");
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao carregar organizações."));
  return corpo.organizacoes;
}

export async function criarOrganizacao(nome: string) {
  const resposta = await requisicaoAutenticada("/api/auth/organizacoes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome }),
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao criar organização."));
  return corpo;
}

// Reemite a sessão pra outra organização de que o usuário já é membro —
// recarregar a página depois é responsabilidade de quem chama (o cookie já
// mudou, mas qualquer estado em memória do React ainda reflete a org
// anterior).
export async function entrarNaOrganizacao(id: string) {
  const resposta = await requisicaoAutenticada(`/api/auth/organizacoes/${id}/entrar`, {
    method: "POST",
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao trocar de organização."));
  return corpo;
}

export async function listarConvites(): Promise<ConviteOrganizacao[]> {
  const resposta = await requisicaoAutenticada("/api/auth/organizacoes/convites");
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao carregar convites."));
  return corpo.convites;
}

export async function criarConvite(dados: { email: string; papel: "admin" | "membro" }) {
  const resposta = await requisicaoAutenticada("/api/auth/organizacoes/convites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados),
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao enviar convite."));
  return corpo;
}

export async function revogarConvite(id: string) {
  const resposta = await requisicaoAutenticada(`/api/auth/organizacoes/convites/${id}`, {
    method: "DELETE",
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao cancelar convite."));
}

export async function aceitarConvite(token: string) {
  const resposta = await requisicaoAutenticada("/api/auth/organizacoes/aceitar-convite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao aceitar convite."));
  return corpo;
}
