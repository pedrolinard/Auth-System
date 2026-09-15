import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";
import { errors, jwtVerify, SignJWT } from "jose";

import { aplicacaoEstaAtiva, hostDaRequisicao } from "@/lib/aplicacao";
import { obterChaveAtiva } from "@/lib/chavesAssinatura";
import { compararEmTempoConstante } from "@/lib/cripto";
import { prisma } from "@/lib/db";
import { revogacao } from "@/lib/revogacao";
import { bloqueioPorSuspensao, criarSessaoSemCookies, resolverOrganizacaoAtiva } from "@/lib/sessao";
import { DURACAO_TOKEN_ACESSO_SEGUNDOS, gerarTokenAcesso, hashToken } from "@/lib/token";

// Login hospedado (OpenID Connect, fluxo authorization code + PKCE). A
// aplicação cliente manda o usuário pra /autorizar; ele entra NESTA página, no
// domínio do provedor; o provedor devolve um código de uso único ao
// redirect_uri; o backend (ou a SPA, como cliente público) troca o código por
// tokens em /api/oidc/token. O cliente nunca vê a senha.
//
// Decisões:
// - PKCE S256 obrigatório pra todo cliente (OAuth 2.1). `plain` é recusado.
// - redirect_uri comparado por igualdade EXATA de string com as URLs
//   cadastradas, antes de qualquer redirecionamento.
// - Sem sessão hospedada (SSO) nesta versão: cada /autorizar pede login. O
//   provedor nunca grava cookie de sessão pra conta de aplicação cliente.
// - Só aplicação APROVADA pelo operador usa o login hospedado: uma página no
//   domínio do provedor com o nome de um aplicativo qualquer é o phishing
//   mais convincente que existe.

export const ESCOPOS_SUPORTADOS = ["openid", "email", "profile", "offline_access"] as const;
const VIDA_CODIGO_MS = 60 * 1000;
const VIDA_PEDIDO = "10m";
const VIDA_ID_TOKEN = "15m";
const MAX_TAMANHO_STATE = 512;

/**
 * As rotas que a página hospedada chama (/api/oidc/entrar e /mfa) só aceitam
 * a própria origem do provedor. Sem Origin não há navegador — logo, não há
 * CSRF de login possível (testes, curl).
 */
export function origemDoProprioProvedor(req: Request): boolean {
  const origem = req.headers.get("origin");
  if (!origem) return true;
  try {
    return new URL(origem).host === hostDaRequisicao(req);
  } catch {
    return false;
  }
}

/** O `iss` do id_token e do discovery: a URL pública do provedor. */
export function emissorOidc(): string {
  return (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

// Chave do pedido assinado, derivada do segredo do refresh token com um
// rótulo próprio: sem env var nova pra esquecer em produção, e um token de um
// tipo nunca verifica como outro.
function chavePedido(): Uint8Array {
  return createHmac("sha256", process.env.JWT_REFRESH_SECRET ?? "")
    .update("oidc:pedido-autorizacao")
    .digest();
}

export type PedidoAutorizacao = {
  aplicacaoId: string;
  clientId: string;
  redirectUri: string;
  escopo: string;
  state: string | null;
  nonce: string | null;
  codeChallenge: string;
};

export type ResultadoValidacaoPedido =
  // Não dá pra confiar no redirect_uri: mostra o erro na página, nunca redireciona.
  | { tipo: "erro_pagina"; mensagem: string }
  // redirect_uri válido: o erro volta pro cliente, com o state.
  | { tipo: "erro_redirect"; url: string }
  | {
      tipo: "ok";
      pedido: PedidoAutorizacao;
      pedidoAssinado: string;
      aplicacao: { nome: string; logoUrl: string | null };
    };

function urlComErro(redirectUri: string, erro: string, descricao: string, state: string | null): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", erro);
  url.searchParams.set("error_description", descricao);
  if (state) url.searchParams.set("state", state);
  url.searchParams.set("iss", emissorOidc());
  return url.toString();
}

/** Valida os parâmetros de GET /autorizar. */
export async function validarPedidoAutorizacao(params: URLSearchParams): Promise<ResultadoValidacaoPedido> {
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  if (!clientId || !redirectUri) {
    return { tipo: "erro_pagina", mensagem: "Pedido de login incompleto: faltam client_id ou redirect_uri." };
  }

  const aplicacao = await prisma.aplicacao.findFirst({
    where: { clientId, ativa: true, padrao: false },
    select: { id: true, nome: true, logoUrl: true, aprovada: true, redirectUris: true },
  });
  if (!aplicacao) {
    return { tipo: "erro_pagina", mensagem: "Aplicação desconhecida ou desativada." };
  }
  if (!aplicacao.redirectUris.includes(redirectUri)) {
    return { tipo: "erro_pagina", mensagem: "Este endereço de retorno não está cadastrado para a aplicação." };
  }
  if (!aplicacao.aprovada) {
    return { tipo: "erro_pagina", mensagem: "Esta aplicação ainda não foi aprovada para o login hospedado." };
  }

  // A partir daqui o redirect_uri é confiável: erros voltam pro cliente.
  const stateBruto = params.get("state");
  if (stateBruto && stateBruto.length > MAX_TAMANHO_STATE) {
    return { tipo: "erro_redirect", url: urlComErro(redirectUri, "invalid_request", "state longo demais.", null) };
  }
  const state = stateBruto || null;
  const erro = (codigo: string, descricao: string): ResultadoValidacaoPedido => ({
    tipo: "erro_redirect",
    url: urlComErro(redirectUri, codigo, descricao, state),
  });

  if (params.get("response_type") !== "code") {
    return erro("unsupported_response_type", "Só o fluxo authorization code é suportado.");
  }
  const escopos = (params.get("scope") ?? "").split(" ").filter(Boolean);
  if (!escopos.includes("openid")) {
    return erro("invalid_scope", "O escopo precisa incluir openid.");
  }
  const codeChallenge = params.get("code_challenge");
  if (!codeChallenge || params.get("code_challenge_method") !== "S256") {
    return erro("invalid_request", "PKCE com code_challenge_method=S256 é obrigatório.");
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    return erro("invalid_request", "code_challenge inválido.");
  }
  // Sem sessão hospedada, não há como autenticar sem mostrar a tela.
  if (params.get("prompt") === "none") {
    return erro("login_required", "É preciso entrar.");
  }
  const nonce = params.get("nonce");
  if (nonce && nonce.length > MAX_TAMANHO_STATE) {
    return erro("invalid_request", "nonce longo demais.");
  }

  const pedido: PedidoAutorizacao = {
    aplicacaoId: aplicacao.id,
    clientId,
    redirectUri,
    escopo: [...new Set(escopos.filter((e) => (ESCOPOS_SUPORTADOS as readonly string[]).includes(e)))].join(" "),
    state,
    nonce: nonce || null,
    codeChallenge,
  };
  const pedidoAssinado = await new SignJWT({ ...pedido, tipo: "pedido_oidc" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(VIDA_PEDIDO)
    .sign(chavePedido());

  return { tipo: "ok", pedido, pedidoAssinado, aplicacao: { nome: aplicacao.nome, logoUrl: aplicacao.logoUrl } };
}

/** Confere o pedido assinado que a página /autorizar entregou ao navegador. */
export async function verificarPedidoAssinado(token: unknown): Promise<PedidoAutorizacao | null> {
  if (typeof token !== "string" || token.length > 4096) return null;
  try {
    const { payload } = await jwtVerify<PedidoAutorizacao & { tipo: string }>(token, chavePedido(), {
      algorithms: ["HS256"],
    });
    if (payload.tipo !== "pedido_oidc") return null;
    const { aplicacaoId, clientId, redirectUri, escopo, state, nonce, codeChallenge } = payload;
    return { aplicacaoId, clientId, redirectUri, escopo, state, nonce, codeChallenge };
  } catch (erro) {
    if (erro instanceof errors.JOSEError) return null;
    throw erro;
  }
}

/**
 * Emite o código de autorização depois que a pessoa entrou e devolve a URL de
 * retorno. O pedido é revalidado contra o banco: a aplicação pode ter sido
 * desativada, desaprovada ou ter a URL removida nos minutos desde /autorizar.
 */
export async function emitirCodigoAutorizacao(
  pedido: PedidoAutorizacao,
  usuario: { id: string; aplicacaoId: string },
): Promise<string | null> {
  if (usuario.aplicacaoId !== pedido.aplicacaoId) return null;
  const aplicacao = await prisma.aplicacao.findFirst({
    where: { id: pedido.aplicacaoId, ativa: true, aprovada: true },
    select: { redirectUris: true },
  });
  if (!aplicacao?.redirectUris.includes(pedido.redirectUri)) return null;

  const codigo = randomBytes(32).toString("base64url");
  const agora = new Date();
  await prisma.codigoAutorizacao.create({
    data: {
      codigoHash: hashToken(codigo),
      aplicacaoId: pedido.aplicacaoId,
      usuarioId: usuario.id,
      redirectUri: pedido.redirectUri,
      escopo: pedido.escopo,
      nonce: pedido.nonce,
      codeChallenge: pedido.codeChallenge,
      autenticadoEm: agora,
      expiraEm: new Date(agora.getTime() + VIDA_CODIGO_MS),
    },
  });

  const url = new URL(pedido.redirectUri);
  url.searchParams.set("code", codigo);
  if (pedido.state) url.searchParams.set("state", pedido.state);
  // RFC 9207: o cliente confere de quem veio a resposta (mix-up).
  url.searchParams.set("iss", emissorOidc());
  return url.toString();
}

export type ClienteAutenticado = { aplicacaoId: string; clientId: string };

export type ErroOAuth = { status: number; error: string; error_description: string; basic?: boolean };

/**
 * Autenticação do cliente no /token: client_secret_basic, client_secret_post
 * ou nenhuma (cliente público — aí o PKCE, sempre obrigatório, é a prova).
 * Um segredo que veio e não confere é sempre invalid_client.
 */
export async function autenticarClienteOidc(
  req: Request,
  campos: URLSearchParams,
): Promise<{ ok: true; cliente: ClienteAutenticado } | { ok: false; erro: ErroOAuth }> {
  let clientId = campos.get("client_id");
  let segredo = campos.get("client_secret");
  const cabecalho = req.headers.get("authorization");
  const viaBasic = !!cabecalho?.startsWith("Basic ");

  if (viaBasic) {
    if (segredo) {
      return { ok: false, erro: { status: 400, error: "invalid_request", error_description: "Use um só método de autenticação do cliente." } };
    }
    const decodificado = Buffer.from(cabecalho!.slice("Basic ".length), "base64").toString("utf8");
    const separador = decodificado.indexOf(":");
    if (separador < 0) {
      return { ok: false, erro: { status: 401, error: "invalid_client", error_description: "Credencial do cliente malformada.", basic: true } };
    }
    const idBasic = decodeURIComponent(decodificado.slice(0, separador));
    if (clientId && clientId !== idBasic) {
      return { ok: false, erro: { status: 400, error: "invalid_request", error_description: "client_id divergente." } };
    }
    clientId = idBasic;
    segredo = decodeURIComponent(decodificado.slice(separador + 1));
  }

  const falha: ErroOAuth = { status: 401, error: "invalid_client", error_description: "Cliente desconhecido ou credencial inválida.", basic: viaBasic };
  if (!clientId) return { ok: false, erro: falha };

  const aplicacao = await prisma.aplicacao.findFirst({
    where: { clientId, ativa: true, aprovada: true, padrao: false },
    select: { id: true, clientSecretHash: true },
  });
  if (!aplicacao) return { ok: false, erro: falha };
  if (segredo !== null) {
    const confere =
      !!aplicacao.clientSecretHash &&
      compararEmTempoConstante(createHash("sha256").update(segredo).digest("hex"), aplicacao.clientSecretHash);
    if (!confere) return { ok: false, erro: falha };
  }
  return { ok: true, cliente: { aplicacaoId: aplicacao.id, clientId } };
}

const CONCESSAO_INVALIDA = (descricao: string): ErroOAuth => ({
  status: 400,
  error: "invalid_grant",
  error_description: descricao,
});

function pkceConfere(codeVerifier: string, codeChallenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) return false;
  const calculado = createHash("sha256").update(codeVerifier).digest("base64url");
  return compararEmTempoConstante(calculado, codeChallenge);
}

export type RespostaToken = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  id_token: string;
  refresh_token?: string;
  scope: string;
};

/** Troca de código por tokens (grant_type=authorization_code). */
export async function trocarCodigoPorTokens(
  req: Request,
  cliente: ClienteAutenticado,
  campos: URLSearchParams,
): Promise<{ ok: true; resposta: RespostaToken } | { ok: false; erro: ErroOAuth }> {
  const codigo = campos.get("code");
  const redirectUri = campos.get("redirect_uri");
  const codeVerifier = campos.get("code_verifier");
  if (!codigo || !redirectUri || !codeVerifier) {
    return { ok: false, erro: { status: 400, error: "invalid_request", error_description: "code, redirect_uri e code_verifier são obrigatórios." } };
  }

  const registro = await prisma.codigoAutorizacao.findUnique({
    where: { codigoHash: hashToken(codigo) },
    include: {
      usuario: { select: { id: true, nome: true, email: true, emailVerificado: true, papel: true, aplicacaoId: true } },
    },
  });
  // Código de outra aplicação: só inválido, sem efeito colateral na sessão
  // de outro cliente.
  if (!registro || registro.aplicacaoId !== cliente.aplicacaoId) {
    return { ok: false, erro: CONCESSAO_INVALIDA("Código inválido.") };
  }
  if (registro.usadoEm) {
    if (registro.sessaoId) {
      await prisma.tokenAtualizacao.updateMany({
        where: { id: registro.sessaoId, revogadoEm: null },
        data: revogacao("codigo_oidc_reapresentado"),
      });
    }
    return { ok: false, erro: CONCESSAO_INVALIDA("Código já utilizado.") };
  }
  if (registro.expiraEm < new Date()) {
    return { ok: false, erro: CONCESSAO_INVALIDA("Código expirado.") };
  }
  if (registro.redirectUri !== redirectUri) {
    return { ok: false, erro: CONCESSAO_INVALIDA("redirect_uri diferente do usado na autorização.") };
  }
  if (!pkceConfere(codeVerifier, registro.codeChallenge)) {
    return { ok: false, erro: CONCESSAO_INVALIDA("code_verifier não confere.") };
  }

  // Uso único mesmo com duas trocas simultâneas: só uma marca o código.
  const { count } = await prisma.codigoAutorizacao.updateMany({
    where: { id: registro.id, usadoEm: null },
    data: { usadoEm: new Date() },
  });
  if (count !== 1) return { ok: false, erro: CONCESSAO_INVALIDA("Código já utilizado.") };

  const { usuario } = registro;
  if (!(await aplicacaoEstaAtiva(usuario.aplicacaoId)) || (await bloqueioPorSuspensao(usuario.id))) {
    return { ok: false, erro: CONCESSAO_INVALIDA("A conta não pode entrar agora.") };
  }

  const escopos = registro.escopo.split(" ");
  let tokenAcesso: string;
  let tokenAtualizacao: string | undefined;
  if (escopos.includes("offline_access")) {
    const sessao = await criarSessaoSemCookies(usuario, req);
    tokenAcesso = sessao.tokenAcesso;
    tokenAtualizacao = sessao.tokenAtualizacao;
    await prisma.codigoAutorizacao.update({ where: { id: registro.id }, data: { sessaoId: sessao.sessaoId } });
  } else {
    // Sem offline_access não há refresh token — nem sessão persistida pra ele.
    const { organizacaoId, papelOrganizacao } = await resolverOrganizacaoAtiva(usuario.id);
    tokenAcesso = await gerarTokenAcesso({
      sub: usuario.id,
      email: usuario.email,
      papel: usuario.papel,
      aplicacaoId: usuario.aplicacaoId,
      organizacaoId,
      papelOrganizacao,
    });
  }

  const idToken = await gerarIdToken({
    usuario,
    clientId: cliente.clientId,
    escopos,
    nonce: registro.nonce,
    autenticadoEm: registro.autenticadoEm,
  });

  return {
    ok: true,
    resposta: {
      access_token: tokenAcesso,
      token_type: "Bearer",
      expires_in: DURACAO_TOKEN_ACESSO_SEGUNDOS,
      id_token: idToken,
      ...(tokenAtualizacao ? { refresh_token: tokenAtualizacao } : {}),
      scope: registro.escopo,
    },
  };
}

/** Claims montados campo a campo, conforme os escopos pedidos. */
export function claimsDoUsuario(
  usuario: { id: string; nome: string; email: string; emailVerificado: boolean },
  escopos: string[],
): Record<string, unknown> {
  return {
    sub: usuario.id,
    ...(escopos.includes("email") ? { email: usuario.email, email_verified: usuario.emailVerificado } : {}),
    ...(escopos.includes("profile") ? { name: usuario.nome } : {}),
  };
}

async function gerarIdToken(dados: {
  usuario: { id: string; nome: string; email: string; emailVerificado: boolean };
  clientId: string;
  escopos: string[];
  nonce: string | null;
  autenticadoEm: Date;
}): Promise<string> {
  const { kid, privada } = await obterChaveAtiva();
  return new SignJWT({
    ...claimsDoUsuario(dados.usuario, dados.escopos),
    auth_time: Math.floor(dados.autenticadoEm.getTime() / 1000),
    azp: dados.clientId,
    ...(dados.nonce ? { nonce: dados.nonce } : {}),
  })
    .setProtectedHeader({ alg: "RS256", kid, typ: "JWT" })
    .setIssuer(emissorOidc())
    .setSubject(dados.usuario.id)
    .setAudience(dados.clientId)
    .setIssuedAt()
    .setExpirationTime(VIDA_ID_TOKEN)
    .sign(privada);
}

/** Documento de discovery (/.well-known/openid-configuration). */
export function documentoDescoberta() {
  const emissor = emissorOidc();
  return {
    issuer: emissor,
    authorization_endpoint: `${emissor}/autorizar`,
    token_endpoint: `${emissor}/api/oidc/token`,
    userinfo_endpoint: `${emissor}/api/oidc/userinfo`,
    jwks_uri: `${emissor}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: [...ESCOPOS_SUPORTADOS],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    code_challenge_methods_supported: ["S256"],
    claims_supported: ["sub", "email", "email_verified", "name", "auth_time", "nonce", "azp"],
    authorization_response_iss_parameter_supported: true,
  };
}
