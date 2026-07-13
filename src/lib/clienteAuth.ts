"use client";

const CHAVE_TOKEN_ACESSO = "tokenAcesso";

export function salvarTokenAcesso(token: string) {
  sessionStorage.setItem(CHAVE_TOKEN_ACESSO, token);
}

export function obterTokenAcesso(): string | null {
  return sessionStorage.getItem(CHAVE_TOKEN_ACESSO);
}

export function limparTokenAcesso() {
  sessionStorage.removeItem(CHAVE_TOKEN_ACESSO);
}

export async function cadastrar(dados: {
  nome: string;
  email: string;
  senha: string;
}) {
  const resposta = await fetch("/api/auth/cadastro", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados),
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(corpo.erro ?? "Falha no cadastro.");
  return corpo;
}

export async function entrar(dados: { email: string; senha: string }) {
  const resposta = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados),
    credentials: "include",
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(corpo.erro ?? "Falha no login.");
  salvarTokenAcesso(corpo.tokenAcesso);
  return corpo;
}

export async function sair() {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
  limparTokenAcesso();
}

export async function obterUsuarioAtual() {
  const token = obterTokenAcesso();
  if (!token) return null;

  const resposta = await fetch("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (resposta.status === 401) {
    const renovado = await tentarAtualizarToken();
    if (!renovado) return null;
    return obterUsuarioAtual();
  }

  if (!resposta.ok) return null;
  const corpo = await resposta.json();
  return corpo.usuario;
}

export async function tentarAtualizarToken(): Promise<boolean> {
  const resposta = await fetch("/api/auth/atualizar", {
    method: "POST",
    credentials: "include",
  });
  if (!resposta.ok) {
    limparTokenAcesso();
    return false;
  }
  const corpo = await resposta.json();
  salvarTokenAcesso(corpo.tokenAcesso);
  return true;
}
