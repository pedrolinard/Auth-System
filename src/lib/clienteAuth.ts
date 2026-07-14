"use client";

// Lê o cookie CSRF (não-httpOnly de propósito) pra ecoar no header
// X-CSRF-Token nas mutações autenticadas — ver src/lib/csrf.ts no servidor
// (Next.js) e comum/autenticacao.py (Django, mesma regra).
export function obterCookieCsrfCliente(): string | null {
  const encontrado = document.cookie
    .split("; ")
    .find((linha) => linha.startsWith("csrfToken="));
  return encontrado ? decodeURIComponent(encontrado.split("=")[1]) : null;
}

export function cabecalhoCsrf(): HeadersInit {
  const token = obterCookieCsrfCliente();
  return token ? { "X-CSRF-Token": token } : {};
}

// As rotas devolvem `detalhes` (saída de Zod `.flatten()`) junto do erro
// genérico quando a validação falha — sem isso, toda falha de senha/e-mail/
// nome aparecia como "Dados inválidos." sem dizer qual campo nem por quê.
type CorpoErro = {
  erro?: string;
  detalhes?: { fieldErrors?: Record<string, string[]> };
};

function mensagemErro(corpo: CorpoErro, padrao: string): string {
  const primeiroCampoComErro = Object.values(corpo.detalhes?.fieldErrors ?? {}).find(
    (mensagens) => mensagens.length > 0,
  );
  return primeiroCampoComErro?.[0] ?? corpo.erro ?? padrao;
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
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha no cadastro."));
  return corpo;
}

export async function solicitarRecuperacaoSenha(email: string) {
  const resposta = await fetch("/api/auth/esqueci-senha", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao solicitar recuperação."));
  return corpo;
}

export async function redefinirSenha(token: string, novaSenha: string) {
  const resposta = await fetch("/api/auth/redefinir-senha", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, novaSenha }),
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao redefinir senha."));
}

export async function verificarEmail(token: string) {
  const resposta = await fetch("/api/auth/verificar-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(corpo.erro ?? "Falha ao verificar e-mail.");
}

export async function reenviarVerificacaoEmail() {
  const resposta = await fetch("/api/auth/reenviar-verificacao", {
    method: "POST",
    headers: cabecalhoCsrf(),
    credentials: "include",
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao reenviar e-mail."));
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

  if (corpo.mfaObrigatorio) {
    return { mfaObrigatorio: true as const, mfaToken: corpo.mfaToken as string };
  }

  return { mfaObrigatorio: false as const, ...corpo };
}

export async function verificarMfaLogin(dados: {
  mfaToken: string;
  codigo: string;
}) {
  const resposta = await fetch("/api/auth/mfa/verificar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados),
    credentials: "include",
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(corpo.erro ?? "Código inválido.");
  return corpo;
}

export async function sair() {
  await fetch("/api/auth/logout", {
    method: "POST",
    headers: cabecalhoCsrf(),
    credentials: "include",
  });
}

export async function obterUsuarioAtual(tentouRenovar = false) {
  const resposta = await fetch("/api/auth/me", { credentials: "include" });

  if (resposta.status === 401 && !tentouRenovar) {
    const renovado = await tentarAtualizarToken();
    if (!renovado) return null;
    return obterUsuarioAtual(true);
  }

  if (!resposta.ok) return null;
  const corpo = await resposta.json();
  return corpo.usuario;
}

export async function tentarAtualizarToken(): Promise<boolean> {
  const resposta = await fetch("/api/auth/atualizar", {
    method: "POST",
    headers: cabecalhoCsrf(),
    credentials: "include",
  });
  return resposta.ok;
}

export type Sessao = {
  id: string;
  criadoEm: string;
  expiraEm: string;
  atual: boolean;
};

export async function listarSessoes(): Promise<Sessao[]> {
  const resposta = await fetch("/api/auth/sessoes", { credentials: "include" });
  if (!resposta.ok) throw new Error("Falha ao carregar sessões.");
  const corpo = await resposta.json();
  return corpo.sessoes;
}

export type UsuarioAdmin = {
  id: string;
  nome: string;
  email: string;
  papel: "usuario" | "admin";
  criadoEm: string;
};

export async function listarUsuarios(): Promise<UsuarioAdmin[]> {
  const resposta = await fetch("/api/auth/usuarios", { credentials: "include" });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(corpo.erro ?? "Falha ao carregar usuários.");
  return corpo.usuarios;
}

export async function revogarSessao(id: string) {
  const resposta = await fetch(`/api/auth/sessoes/${id}`, {
    method: "DELETE",
    headers: cabecalhoCsrf(),
    credentials: "include",
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(corpo.erro ?? "Falha ao revogar sessão.");
}

export async function revogarTodasSessoes() {
  const resposta = await fetch("/api/auth/sessoes", {
    method: "DELETE",
    headers: cabecalhoCsrf(),
    credentials: "include",
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(corpo.erro ?? "Falha ao revogar sessões.");
}

export async function iniciarMfa(): Promise<{
  segredo: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}> {
  const resposta = await fetch("/api/auth/mfa/iniciar", {
    method: "POST",
    headers: cabecalhoCsrf(),
    credentials: "include",
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(corpo.erro ?? "Falha ao iniciar MFA.");
  return corpo;
}

export async function confirmarMfa(codigo: string) {
  const resposta = await fetch("/api/auth/mfa/confirmar", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cabecalhoCsrf() },
    credentials: "include",
    body: JSON.stringify({ codigo }),
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(corpo.erro ?? "Código inválido.");
}

export async function desativarMfa(codigo: string) {
  const resposta = await fetch("/api/auth/mfa/desativar", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cabecalhoCsrf() },
    credentials: "include",
    body: JSON.stringify({ codigo }),
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(corpo.erro ?? "Código inválido.");
}
