import { createHash, randomBytes } from "node:crypto";
import * as OTPAuth from "otpauth";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { validarPedidoAutorizacao } from "@/lib/oidc";
import {
  apagarAplicacoesTeste,
  BASE_URL,
  cabecalhosAplicacao,
  criarAplicacaoTeste,
  gerarEmailTeste,
  ipAleatorio,
  SENHA_TESTE,
  type AplicacaoTeste,
} from "../helpers";

// Login hospedado (OpenID Connect, authorization code + PKCE), de ponta a ponta
// contra o servidor real, como uma biblioteca OAuth de cliente usaria.

const RETORNO = "https://app.cliente-oidc.example/auth/retorno";
const aplicacoesCriadas: string[] = [];
const jwks = createRemoteJWKSet(new URL(`${BASE_URL}/.well-known/jwks.json`));
const EMISSOR = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

afterAll(async () => {
  await apagarAplicacoesTeste(aplicacoesCriadas);
});

async function novaAplicacao(opcoes: { aprovada?: boolean } = {}) {
  const aplicacao = await criarAplicacaoTeste("Cliente OIDC", { aprovada: opcoes.aprovada });
  aplicacoesCriadas.push(aplicacao.id);
  await prisma.aplicacao.update({ where: { id: aplicacao.id }, data: { redirectUris: [RETORNO] } });
  return aplicacao;
}

async function novaConta(aplicacao: AplicacaoTeste) {
  const email = gerarEmailTeste("oidc");
  const cadastro = await fetch(`${BASE_URL}/api/auth/cadastro`, {
    method: "POST",
    headers: cabecalhosAplicacao(aplicacao),
    body: JSON.stringify({ nome: "Pessoa OIDC", email, senha: SENHA_TESTE }),
  });
  expect(cadastro.status).toBe(201);
  return email;
}

function pkce() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function parametros(aplicacao: AplicacaoTeste, extras: Record<string, string> = {}) {
  const { verifier, challenge } = pkce();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: aplicacao.clientId,
    redirect_uri: RETORNO,
    scope: "openid email profile offline_access",
    state: `estado-${randomBytes(6).toString("hex")}`,
    nonce: `nonce-${randomBytes(6).toString("hex")}`,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...extras,
  });
  return { params, verifier };
}

async function pedidoAssinado(params: URLSearchParams): Promise<string> {
  const resultado = await validarPedidoAutorizacao(params);
  if (resultado.tipo !== "ok") throw new Error(`pedido inválido: ${JSON.stringify(resultado)}`);
  return resultado.pedidoAssinado;
}

async function entrar(pedido: string, email: string, extras: Record<string, string> = {}) {
  return fetch(`${BASE_URL}/api/oidc/entrar`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ipAleatorio(), ...extras },
    body: JSON.stringify({ pedido, email, senha: SENHA_TESTE }),
  });
}

/** Autoriza e devolve o código já recebido no retorno. */
async function obterCodigo(aplicacao: AplicacaoTeste, email: string, extras: Record<string, string> = {}) {
  const { params, verifier } = parametros(aplicacao, extras);
  const resposta = await entrar(await pedidoAssinado(params), email);
  expect(resposta.status).toBe(200);
  expect(resposta.headers.getSetCookie().join(";")).not.toContain("tokenAcesso=");
  const { redirecionar } = await resposta.json();
  const retorno = new URL(redirecionar);
  expect(`${retorno.origin}${retorno.pathname}`).toBe(RETORNO);
  expect(retorno.searchParams.get("state")).toBe(params.get("state"));
  expect(retorno.searchParams.get("iss")).toBe(EMISSOR);
  return { codigo: retorno.searchParams.get("code")!, verifier, nonce: params.get("nonce")! };
}

function trocar(aplicacao: AplicacaoTeste, campos: Record<string, string>, opcoes: { basic?: boolean } = { basic: true }) {
  const cabecalhos: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    "X-Forwarded-For": ipAleatorio(),
  };
  if (opcoes.basic) {
    cabecalhos.Authorization = `Basic ${Buffer.from(`${aplicacao.clientId}:${aplicacao.clientSecret}`).toString("base64")}`;
  }
  return fetch(`${BASE_URL}/api/oidc/token`, {
    method: "POST",
    headers: cabecalhos,
    body: new URLSearchParams(campos).toString(),
  });
}

describe("OpenID Connect — discovery e /autorizar", () => {
  it("publica o discovery com PKCE S256 e o JWKS", async () => {
    const resposta = await fetch(`${BASE_URL}/.well-known/openid-configuration`);
    expect(resposta.status).toBe(200);
    const doc = await resposta.json();
    expect(doc.issuer).toBe(EMISSOR);
    expect(doc.authorization_endpoint).toBe(`${EMISSOR}/autorizar`);
    expect(doc.token_endpoint).toBe(`${EMISSOR}/api/oidc/token`);
    expect(doc.code_challenge_methods_supported).toEqual(["S256"]);
    expect(doc.id_token_signing_alg_values_supported).toEqual(["RS256"]);
  });

  it("redirect_uri não cadastrado: erro na página, sem redirecionar", async () => {
    const aplicacao = await novaAplicacao();
    const { params } = parametros(aplicacao, { redirect_uri: "https://atacante.example/pega-codigo" });
    const resposta = await fetch(`${BASE_URL}/autorizar?${params}`, { redirect: "manual" });
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("location")).toBeNull();
    expect(await resposta.text()).toContain("não está cadastrado");

    // Prefixo da URL cadastrada também não serve.
    const { params: comPrefixo } = parametros(aplicacao, { redirect_uri: `${RETORNO}/../outro` });
    expect((await validarPedidoAutorizacao(comPrefixo)).tipo).toBe("erro_pagina");
  });

  it("sem PKCE S256 (ou com plain): volta ao cliente com invalid_request e o state", async () => {
    const aplicacao = await novaAplicacao();
    const { params } = parametros(aplicacao, { code_challenge_method: "plain" });
    const resposta = await fetch(`${BASE_URL}/autorizar?${params}`, { redirect: "manual" });
    expect([303, 307]).toContain(resposta.status);
    const destino = new URL(resposta.headers.get("location")!);
    expect(`${destino.origin}${destino.pathname}`).toBe(RETORNO);
    expect(destino.searchParams.get("error")).toBe("invalid_request");
    expect(destino.searchParams.get("state")).toBe(params.get("state"));
  });

  it("aplicação não aprovada não usa o login hospedado", async () => {
    const aplicacao = await novaAplicacao({ aprovada: false });
    const { params } = parametros(aplicacao);
    const resultado = await validarPedidoAutorizacao(params);
    expect(resultado.tipo).toBe("erro_pagina");
  });

  it("pedido válido mostra a tela de login com o nome da aplicação", async () => {
    const aplicacao = await novaAplicacao();
    const { params } = parametros(aplicacao);
    const resposta = await fetch(`${BASE_URL}/autorizar?${params}`, { redirect: "manual" });
    expect(resposta.status).toBe(200);
    expect(await resposta.text()).toContain("Entrar em Cliente OIDC");
  });
});

describe("OpenID Connect — código e tokens", () => {
  it("fluxo completo: código → tokens (id_token válido) → userinfo → refresh", async () => {
    const aplicacao = await novaAplicacao();
    const email = await novaConta(aplicacao);
    const { codigo, verifier, nonce } = await obterCodigo(aplicacao, email);

    const resposta = await trocar(aplicacao, {
      grant_type: "authorization_code",
      code: codigo,
      redirect_uri: RETORNO,
      code_verifier: verifier,
    });
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("cache-control")).toContain("no-store");
    expect(resposta.headers.getSetCookie()).toEqual([]);
    const tokens = await resposta.json();
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.refresh_token).toBeTruthy();

    const { payload } = await jwtVerify(tokens.id_token, jwks, {
      algorithms: ["RS256"],
      issuer: EMISSOR,
      audience: aplicacao.clientId,
    });
    expect(payload.nonce).toBe(nonce);
    expect(payload.email).toBe(email);
    expect(payload.name).toBe("Pessoa OIDC");
    expect(payload).not.toHaveProperty("senhaHash");

    const userinfo = await fetch(`${BASE_URL}/api/oidc/userinfo`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    expect(userinfo.status).toBe(200);
    const claims = await userinfo.json();
    expect(claims).toEqual({ sub: payload.sub, email, email_verified: false, name: "Pessoa OIDC" });

    const renovado = await trocar(aplicacao, { grant_type: "refresh_token", refresh_token: tokens.refresh_token });
    expect(renovado.status).toBe(200);
    const novos = await renovado.json();
    expect(novos.refresh_token).not.toBe(tokens.refresh_token);
  });

  it("código é de uso único: reapresentar derruba a sessão emitida com ele", async () => {
    const aplicacao = await novaAplicacao();
    const email = await novaConta(aplicacao);
    const { codigo, verifier } = await obterCodigo(aplicacao, email);
    const campos = { grant_type: "authorization_code", code: codigo, redirect_uri: RETORNO, code_verifier: verifier };

    const primeira = await trocar(aplicacao, campos);
    expect(primeira.status).toBe(200);
    const { refresh_token } = await primeira.json();

    const segunda = await trocar(aplicacao, campos);
    expect(segunda.status).toBe(400);
    expect((await segunda.json()).error).toBe("invalid_grant");

    const renovar = await trocar(aplicacao, { grant_type: "refresh_token", refresh_token });
    expect(renovar.status).toBe(400);
  });

  it("recusa code_verifier errado, redirect_uri diferente, código vencido e código de outra aplicação", async () => {
    const aplicacao = await novaAplicacao();
    const outra = await novaAplicacao();
    const email = await novaConta(aplicacao);

    const a = await obterCodigo(aplicacao, email);
    const verifierErrado = await trocar(aplicacao, {
      grant_type: "authorization_code", code: a.codigo, redirect_uri: RETORNO, code_verifier: pkce().verifier,
    });
    expect((await verifierErrado.json()).error).toBe("invalid_grant");

    const b = await obterCodigo(aplicacao, email);
    const outroRetorno = await trocar(aplicacao, {
      grant_type: "authorization_code", code: b.codigo, redirect_uri: `${RETORNO}?x=1`, code_verifier: b.verifier,
    });
    expect((await outroRetorno.json()).error).toBe("invalid_grant");

    const c = await obterCodigo(aplicacao, email);
    await prisma.codigoAutorizacao.updateMany({
      where: { aplicacaoId: aplicacao.id, usadoEm: null },
      data: { expiraEm: new Date(Date.now() - 1000) },
    });
    const vencido = await trocar(aplicacao, {
      grant_type: "authorization_code", code: c.codigo, redirect_uri: RETORNO, code_verifier: c.verifier,
    });
    expect((await vencido.json()).error).toBe("invalid_grant");

    const d = await obterCodigo(aplicacao, email);
    const deOutra = await trocar(outra, {
      grant_type: "authorization_code", code: d.codigo, redirect_uri: RETORNO, code_verifier: d.verifier,
    });
    expect((await deOutra.json()).error).toBe("invalid_grant");
  });

  it("segredo errado é invalid_client; cliente público (sem segredo) troca só com PKCE", async () => {
    const aplicacao = await novaAplicacao();
    const email = await novaConta(aplicacao);

    const { codigo, verifier } = await obterCodigo(aplicacao, email);
    const segredoErrado = await fetch(`${BASE_URL}/api/oidc/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-For": ipAleatorio() },
      body: new URLSearchParams({
        grant_type: "authorization_code", code: codigo, redirect_uri: RETORNO, code_verifier: verifier,
        client_id: aplicacao.clientId, client_secret: "sec_errado",
      }).toString(),
    });
    expect(segredoErrado.status).toBe(401);
    expect((await segredoErrado.json()).error).toBe("invalid_client");

    const publico = await fetch(`${BASE_URL}/api/oidc/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-For": ipAleatorio() },
      body: new URLSearchParams({
        grant_type: "authorization_code", code: codigo, redirect_uri: RETORNO, code_verifier: verifier,
        client_id: aplicacao.clientId,
      }).toString(),
    });
    expect(publico.status).toBe(200);
  });

  it("sem offline_access não há refresh_token", async () => {
    const aplicacao = await novaAplicacao();
    const email = await novaConta(aplicacao);
    const { codigo, verifier } = await obterCodigo(aplicacao, email, { scope: "openid email" });
    const resposta = await trocar(aplicacao, {
      grant_type: "authorization_code", code: codigo, redirect_uri: RETORNO, code_verifier: verifier,
    });
    const tokens = await resposta.json();
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeUndefined();
  });
});

describe("OpenID Connect — página hospedada", () => {
  it("/api/oidc/entrar recusa origem de outro site e pedido adulterado", async () => {
    const aplicacao = await novaAplicacao();
    const email = await novaConta(aplicacao);
    const { params } = parametros(aplicacao);
    const pedido = await pedidoAssinado(params);

    const deOutroSite = await entrar(pedido, email, { Origin: "https://site-malicioso.example" });
    expect(deOutroSite.status).toBe(403);

    const adulterado = await entrar(`${pedido.slice(0, -4)}AAAA`, email);
    expect(adulterado.status).toBe(400);
  });

  it("conta de outra aplicação com o mesmo e-mail não entra neste pedido", async () => {
    const aplicacao = await novaAplicacao();
    const outra = await novaAplicacao();
    const email = await novaConta(outra);
    const { params } = parametros(aplicacao);
    const resposta = await entrar(await pedidoAssinado(params), email);
    expect(resposta.status).toBe(401);
  });

  it("com MFA: a segunda etapa emite o código; mfaToken de conta de outra aplicação é recusado", async () => {
    const aplicacao = await novaAplicacao();
    const email = await novaConta(aplicacao);

    // Ativa o MFA da conta pelo próprio fluxo (Bearer, como o SDK).
    const login = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: cabecalhosAplicacao(aplicacao),
      body: JSON.stringify({ email, senha: SENHA_TESTE }),
    });
    const { tokenAcesso } = await login.json();
    const autenticado = { "Content-Type": "application/json", Authorization: `Bearer ${tokenAcesso}`, "X-Forwarded-For": ipAleatorio() };
    const { segredo } = await (await fetch(`${BASE_URL}/api/auth/mfa/iniciar`, { method: "POST", headers: autenticado })).json();
    const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(segredo) });
    const confirmar = await fetch(`${BASE_URL}/api/auth/mfa/confirmar`, {
      method: "POST",
      headers: autenticado,
      body: JSON.stringify({ codigo: totp.generate() }),
    });
    expect(confirmar.status).toBe(200);

    const { params } = parametros(aplicacao);
    const pedido = await pedidoAssinado(params);
    const primeiraEtapa = await entrar(pedido, email);
    const { mfaObrigatorio, mfaToken } = await primeiraEtapa.json();
    expect(mfaObrigatorio).toBe(true);

    // mfaToken de uma conta de OUTRA aplicação, apresentado neste pedido.
    const outra = await novaAplicacao();
    const emailOutra = await novaConta(outra);
    const { params: paramsOutra } = parametros(outra);
    const entrarOutra = await entrar(await pedidoAssinado(paramsOutra), emailOutra);
    expect((await entrarOutra.json()).redirecionar).toBeTruthy(); // sem MFA nessa conta
    const mfaCruzado = await fetch(`${BASE_URL}/api/oidc/mfa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ipAleatorio() },
      body: JSON.stringify({ pedido: await pedidoAssinado(paramsOutra), mfaToken, codigo: totp.generate({ timestamp: Date.now() + 30_000 }) }),
    });
    expect(mfaCruzado.status).toBe(401);

    const segundaEtapa = await fetch(`${BASE_URL}/api/oidc/mfa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ipAleatorio() },
      body: JSON.stringify({ pedido, mfaToken, codigo: totp.generate({ timestamp: Date.now() + 30_000 }) }),
    });
    expect(segundaEtapa.status).toBe(200);
    const { redirecionar } = await segundaEtapa.json();
    expect(new URL(redirecionar).searchParams.get("code")).toBeTruthy();
  });
});
