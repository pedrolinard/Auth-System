import * as OTPAuth from "otpauth";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  apagarUsuariosTeste,
  BASE_URL,
  criarUsuarioTeste,
  extrairCookie,
  ipAleatorio,
  loginTeste,
} from "../helpers";

const emailsCriados: string[] = [];

function gerarCodigoTotp(segredoBase32: string, offsetPeriodos = 0): string {
  const totp = new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(segredoBase32),
  });
  return totp.generate({ timestamp: Date.now() + offsetPeriodos * 30_000 });
}

async function chamar(
  caminho: string,
  headers: Record<string, string>,
  corpo?: object,
  ip: string = ipAleatorio(),
) {
  return fetch(`${BASE_URL}${caminho}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip, ...headers },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
}

async function ativarMfa(email: string, senha: string) {
  const { cabecalhos } = await loginTeste(email, senha);
  const respostaIniciar = await chamar("/api/auth/mfa/iniciar", cabecalhos);
  const { segredo } = await respostaIniciar.json();
  await chamar("/api/auth/mfa/confirmar", cabecalhos, { codigo: gerarCodigoTotp(segredo) });
  return segredo;
}

describe('"Lembrar este dispositivo" (pular MFA)', () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("marcando a opção, o próximo login no mesmo navegador pula o desafio de MFA", async () => {
    const usuario = await criarUsuarioTeste("lembrar-dispositivo");
    emailsCriados.push(usuario.email);
    const segredo = await ativarMfa(usuario.email, usuario.senha);

    const ip = ipAleatorio();
    const login1 = await chamar("/api/auth/login", {}, { email: usuario.email, senha: usuario.senha }, ip);
    const { mfaToken } = await login1.json();

    const verificar = await chamar(
      "/api/auth/mfa/verificar",
      {},
      { mfaToken, codigo: gerarCodigoTotp(segredo, 1), lembrarDispositivo: true },
      ip,
    );
    expect(verificar.status).toBe(200);
    const tokenDispositivo = extrairCookie(verificar, "dispositivoConfiavel");
    expect(tokenDispositivo).toBeTruthy();

    // Segundo login, mesmo "navegador" (cookie de dispositivo confiável
    // anexado) — não deve pedir o segundo fator, mesmo com MFA ativado.
    const login2 = await chamar(
      "/api/auth/login",
      { Cookie: `dispositivoConfiavel=${tokenDispositivo}` },
      { email: usuario.email, senha: usuario.senha },
      ip,
    );
    expect(login2.status).toBe(200);
    const corpoLogin2 = await login2.json();
    expect(corpoLogin2.mfaObrigatorio).toBeFalsy();
    expect(corpoLogin2.tokenAcesso).toBeTruthy();
  });

  it("sem marcar a opção, o próximo login continua exigindo o desafio de MFA", async () => {
    const usuario = await criarUsuarioTeste("nao-lembrar-dispositivo");
    emailsCriados.push(usuario.email);
    const segredo = await ativarMfa(usuario.email, usuario.senha);

    const ip = ipAleatorio();
    const login1 = await chamar("/api/auth/login", {}, { email: usuario.email, senha: usuario.senha }, ip);
    const { mfaToken } = await login1.json();
    await chamar("/api/auth/mfa/verificar", {}, { mfaToken, codigo: gerarCodigoTotp(segredo, 1) }, ip);

    const login2 = await chamar("/api/auth/login", {}, { email: usuario.email, senha: usuario.senha }, ip);
    expect(login2.status).toBe(200);
    const corpoLogin2 = await login2.json();
    expect(corpoLogin2.mfaObrigatorio).toBe(true);
  });

  it("trocar a senha revoga os dispositivos confiáveis existentes", async () => {
    const usuario = await criarUsuarioTeste("lembrar-dispositivo-revogado");
    emailsCriados.push(usuario.email);
    const segredo = await ativarMfa(usuario.email, usuario.senha);

    const ip = ipAleatorio();
    const login1 = await chamar("/api/auth/login", {}, { email: usuario.email, senha: usuario.senha }, ip);
    const { mfaToken } = await login1.json();
    await chamar(
      "/api/auth/mfa/verificar",
      {},
      { mfaToken, codigo: gerarCodigoTotp(segredo, 1), lembrarDispositivo: true },
      ip,
    );

    const usuarioDb = await prisma.usuario.findUniqueOrThrow({ where: { email: usuario.email } });
    expect(await prisma.dispositivoConfiavel.count({ where: { usuarioId: usuarioDb.id } })).toBe(1);

    // Um terceiro código TOTP validado nesta corrida cairia fora da janela de
    // tolerância de ±1 período do relógio real (o teste roda rápido demais
    // pro "agora" ter avançado) — reseta mfaUltimoTimestep pra simular a
    // passagem do tempo, mesmo truque usado em tests/api/mfa.test.ts.
    await prisma.usuario.update({
      where: { id: usuarioDb.id },
      data: { mfaUltimoTimestep: null },
    });

    // Precisa de uma sessão válida pra chamar PUT /api/auth/senha — como o
    // usuário tem MFA ativado, isso exige completar o desafio de novo
    // (loginTeste sozinho não basta, ele só faz o POST /login).
    const loginParaTrocarSenha = await chamar(
      "/api/auth/login",
      {},
      { email: usuario.email, senha: usuario.senha },
      ip,
    );
    const { mfaToken: mfaTokenTrocarSenha } = await loginParaTrocarSenha.json();
    const conclusao = await chamar(
      "/api/auth/mfa/verificar",
      {},
      { mfaToken: mfaTokenTrocarSenha, codigo: gerarCodigoTotp(segredo) },
      ip,
    );
    expect(conclusao.status).toBe(200);
    const cookiesSessao = {
      tokenAcesso: extrairCookie(conclusao, "tokenAcesso"),
      csrfToken: extrairCookie(conclusao, "csrfToken"),
    };

    const respostaTrocarSenha = await fetch(`${BASE_URL}/api/auth/senha`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: `tokenAcesso=${cookiesSessao.tokenAcesso}; csrfToken=${cookiesSessao.csrfToken}`,
        "X-CSRF-Token": cookiesSessao.csrfToken ?? "",
      },
      body: JSON.stringify({ senhaAtual: usuario.senha, novaSenha: "NovaSenhaForte999!" }),
    });
    expect(respostaTrocarSenha.status).toBe(200);

    expect(await prisma.dispositivoConfiavel.count({ where: { usuarioId: usuarioDb.id } })).toBe(0);
  });
});
