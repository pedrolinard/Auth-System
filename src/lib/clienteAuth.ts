"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

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

// Login e cadastro respondem `captchaNecessario: true` (junto do 400) quando
// o IP passou do limite de tentativas sem CAPTCHA — precisa de um tratamento
// diferente de "credenciais erradas": a página precisa saber disso pra
// renderizar o widget do Turnstile, não só mostrar a mensagem de erro.
export class ErroCaptchaNecessario extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroCaptchaNecessario";
  }
}

export async function cadastrar(dados: {
  nome: string;
  email: string;
  senha: string;
  turnstileToken?: string;
}) {
  const resposta = await fetch("/api/auth/cadastro", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados),
  });
  const corpo = await resposta.json();
  if (!resposta.ok) {
    if (corpo.captchaNecessario) {
      throw new ErroCaptchaNecessario(mensagemErro(corpo, "Verificação necessária."));
    }
    throw new Error(mensagemErro(corpo, "Falha no cadastro."));
  }
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

export async function entrar(dados: {
  email: string;
  senha: string;
  turnstileToken?: string;
}) {
  const resposta = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados),
    credentials: "include",
  });
  const corpo = await resposta.json();
  if (!resposta.ok) {
    if (corpo.captchaNecessario) {
      throw new ErroCaptchaNecessario(corpo.erro ?? "Verificação necessária.");
    }
    throw new Error(corpo.erro ?? "Falha no login.");
  }

  if (corpo.mfaObrigatorio) {
    return { mfaObrigatorio: true as const, mfaToken: corpo.mfaToken as string };
  }

  return { mfaObrigatorio: false as const, ...corpo };
}

export async function verificarMfaLogin(dados: {
  mfaToken: string;
  codigo: string;
  lembrarDispositivo?: boolean;
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

export async function trocarSenha(dados: { senhaAtual: string; novaSenha: string }) {
  const resposta = await fetch("/api/auth/senha", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...cabecalhoCsrf() },
    credentials: "include",
    body: JSON.stringify(dados),
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao trocar a senha."));
}

export type Passkey = {
  id: string;
  nome: string | null;
  criadoEm: string;
  ultimoUsoEm: string | null;
};

export async function listarPasskeys(): Promise<Passkey[]> {
  const resposta = await fetch("/api/auth/passkeys", { credentials: "include" });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao listar passkeys."));
  return corpo.passkeys;
}

// Orquestra as duas chamadas ao servidor (opções -> ), com a interação do
// browser (navigator.credentials.create) no meio — se o usuário cancelar o
// prompt do authenticator, startRegistration rejeita e nem chega a chamar
// /confirmar.
export async function registrarPasskey(nome?: string) {
  const respostaOpcoes = await fetch("/api/auth/passkeys/registro/opcoes", {
    method: "POST",
    headers: cabecalhoCsrf(),
    credentials: "include",
  });
  const corpoOpcoes = await respostaOpcoes.json();
  if (!respostaOpcoes.ok) {
    throw new Error(mensagemErro(corpoOpcoes, "Falha ao iniciar o registro da passkey."));
  }

  const respostaAtestacao = await startRegistration({ optionsJSON: corpoOpcoes.options });

  const respostaConfirmar = await fetch("/api/auth/passkeys/registro/confirmar", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cabecalhoCsrf() },
    credentials: "include",
    body: JSON.stringify({
      passkeyToken: corpoOpcoes.passkeyToken,
      resposta: respostaAtestacao,
      nome,
    }),
  });
  const corpoConfirmar = await respostaConfirmar.json();
  if (!respostaConfirmar.ok) {
    throw new Error(mensagemErro(corpoConfirmar, "Falha ao confirmar a passkey."));
  }
}

export async function excluirPasskey(id: string) {
  const resposta = await fetch(`/api/auth/passkeys/${id}`, {
    method: "DELETE",
    headers: cabecalhoCsrf(),
    credentials: "include",
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao excluir a passkey."));
}

// Login sem senha: /login/opcoes nem pede e-mail (credencial "descobrível" —
// ver gerarOpcoesLoginPasskey no servidor); o browser mostra as passkeys
// salvas pra este site e o usuário escolhe qual usar.
export async function entrarComPasskey() {
  const respostaOpcoes = await fetch("/api/auth/passkeys/login/opcoes", { method: "POST" });
  const corpoOpcoes = await respostaOpcoes.json();
  if (!respostaOpcoes.ok) {
    throw new Error(mensagemErro(corpoOpcoes, "Falha ao iniciar o login com passkey."));
  }

  const respostaAsserto = await startAuthentication({ optionsJSON: corpoOpcoes.options });

  const respostaConfirmar = await fetch("/api/auth/passkeys/login/confirmar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ passkeyToken: corpoOpcoes.passkeyToken, resposta: respostaAsserto }),
  });
  const corpoConfirmar = await respostaConfirmar.json();
  if (!respostaConfirmar.ok) {
    throw new Error(mensagemErro(corpoConfirmar, "Falha ao entrar com a passkey."));
  }
  return corpoConfirmar;
}

export async function exportarMeusDados(senha: string): Promise<unknown> {
  const resposta = await fetch("/api/auth/minha-conta/exportar", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cabecalhoCsrf() },
    credentials: "include",
    body: JSON.stringify({ senha }),
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao exportar os dados da conta."));
  return corpo;
}

export async function excluirMinhaConta(senha: string) {
  const resposta = await fetch("/api/auth/minha-conta", {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...cabecalhoCsrf() },
    credentials: "include",
    body: JSON.stringify({ senha }),
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao excluir a conta."));
}

export async function alterarEmail(novoEmail: string, senha: string) {
  const resposta = await fetch("/api/auth/alterar-email", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cabecalhoCsrf() },
    credentials: "include",
    body: JSON.stringify({ novoEmail, senha }),
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao pedir a troca de e-mail."));
}

export async function confirmarAlteracaoEmail(token: string): Promise<string> {
  const resposta = await fetch("/api/auth/confirmar-alteracao-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(corpo.erro ?? "Falha ao confirmar a troca de e-mail.");
  return corpo.novoEmail;
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
  tipoDispositivo: "mobile" | "tablet" | "desktop" | "desconhecido";
  localizacao: string | null;
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
  // Papel NA ORGANIZAÇÃO ativa (dono/admin/membro) — desde o multi-tenant,
  // não é mais o papel de sistema global (usuario/admin).
  papel: "dono" | "admin" | "membro";
  criadoEm: string;
  suspenso: boolean;
  suspensoAte: string | null;
  suspensoMotivo: string | null;
  suspensoAtivo: boolean;
};

export async function listarUsuarios(): Promise<UsuarioAdmin[]> {
  const resposta = await fetch("/api/auth/usuarios", { credentials: "include" });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(corpo.erro ?? "Falha ao carregar usuários.");
  return corpo.usuarios;
}

// Remove o membro da organização ATIVA — não exclui a conta dele (que pode
// pertencer a outras organizações). Exclusão de conta de verdade é
// autoatendimento do próprio titular (excluirMinhaConta).
export async function removerMembroDaOrganizacao(id: string) {
  const resposta = await fetch(`/api/auth/usuarios/${id}`, {
    method: "DELETE",
    headers: cabecalhoCsrf(),
    credentials: "include",
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao remover membro."));
}

export async function suspenderUsuario(id: string, dados: { dias?: number; motivo?: string }) {
  const resposta = await fetch(`/api/auth/usuarios/${id}/suspender`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cabecalhoCsrf() },
    credentials: "include",
    body: JSON.stringify(dados),
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao suspender usuário."));
}

export type RegistroAuditoria = {
  id: string;
  usuarioId: string | null;
  email: string | null;
  evento: string;
  ip: string | null;
  userAgent: string | null;
  criadoEm: string;
  // Só preenchidos quando o ator difere do alvo (ex.: admin agindo sobre
  // outra conta) — email acima continua sendo o do ALVO.
  autorId: string | null;
  autorEmail: string | null;
};

export async function listarAuditoria(filtros?: {
  evento?: string;
  email?: string;
}): Promise<RegistroAuditoria[]> {
  const query = new URLSearchParams();
  if (filtros?.evento) query.set("evento", filtros.evento);
  if (filtros?.email) query.set("email", filtros.email);
  const resposta = await fetch(`/api/auth/auditoria?${query.toString()}`, {
    credentials: "include",
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(corpo.erro ?? "Falha ao carregar auditoria.");
  return corpo.registros;
}

export async function reativarUsuario(id: string) {
  const resposta = await fetch(`/api/auth/usuarios/${id}/reativar`, {
    method: "POST",
    headers: cabecalhoCsrf(),
    credentials: "include",
  });
  const corpo = await resposta.json();
  if (!resposta.ok) throw new Error(mensagemErro(corpo, "Falha ao reativar usuário."));
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
