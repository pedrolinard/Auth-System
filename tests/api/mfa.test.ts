import * as OTPAuth from "otpauth";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  apagarUsuariosTeste,
  BASE_URL,
  criarUsuarioTeste,
  ipAleatorio,
  loginTeste,
} from "../helpers";

const emailsCriados: string[] = [];

function gerarCodigoTotp(segredoBase32: string): string {
  const totp = new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(segredoBase32),
  });
  return totp.generate();
}

// As rotas de MFA têm rate limit por IP (mfa_codigo_falha) — cada teste usa
// um IP falso próprio pra não interferir com outros testes que também
// batem nessas rotas em paralelo (mesmo princípio de tests/helpers.ts).
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

describe("Fluxo de MFA (TOTP)", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("iniciar → confirmar ativa o MFA", async () => {
    const usuario = await criarUsuarioTeste("mfa-ativar");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const respostaIniciar = await chamar("/api/auth/mfa/iniciar", cabecalhos);
    expect(respostaIniciar.status).toBe(200);
    const { segredo } = await respostaIniciar.json();
    expect(segredo).toBeTruthy();

    const respostaConfirmar = await chamar("/api/auth/mfa/confirmar", cabecalhos, {
      codigo: gerarCodigoTotp(segredo),
    });
    expect(respostaConfirmar.status).toBe(200);
    const corpoConfirmar = await respostaConfirmar.json();
    // Códigos de backup são emitidos nesse exato momento — única vez que
    // aparecem em texto puro.
    expect(corpoConfirmar.codigosBackup).toHaveLength(10);
    expect(new Set(corpoConfirmar.codigosBackup).size).toBe(10);

    // Confirma pelo /me que mfaAtivado agora é true.
    const respostaMe = await fetch(`${BASE_URL}/api/auth/me`, { headers: cabecalhos });
    const corpoMe = await respostaMe.json();
    expect(corpoMe.usuario.mfaAtivado).toBe(true);
  });

  it("rejeita código incorreto na confirmação", async () => {
    const usuario = await criarUsuarioTeste("mfa-codigo-errado");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    await chamar("/api/auth/mfa/iniciar", cabecalhos);
    const resposta = await chamar("/api/auth/mfa/confirmar", cabecalhos, {
      codigo: "000000",
    });

    expect(resposta.status).toBe(401);
  });

  it("desativa o MFA com um código válido", async () => {
    const usuario = await criarUsuarioTeste("mfa-desativar");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const respostaIniciar = await chamar("/api/auth/mfa/iniciar", cabecalhos);
    const { segredo } = await respostaIniciar.json();
    await chamar("/api/auth/mfa/confirmar", cabecalhos, { codigo: gerarCodigoTotp(segredo) });

    const respostaDesativar = await chamar("/api/auth/mfa/desativar", cabecalhos, {
      codigo: gerarCodigoTotp(segredo),
    });
    expect(respostaDesativar.status).toBe(200);

    const respostaMe = await fetch(`${BASE_URL}/api/auth/me`, { headers: cabecalhos });
    const corpoMe = await respostaMe.json();
    expect(corpoMe.usuario.mfaAtivado).toBe(false);
  });

  it("desativar o MFA invalida todos os códigos de backup", async () => {
    const usuario = await criarUsuarioTeste("mfa-desativar-invalida-backup");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const respostaIniciar = await chamar("/api/auth/mfa/iniciar", cabecalhos);
    const { segredo } = await respostaIniciar.json();
    const respostaConfirmar = await chamar("/api/auth/mfa/confirmar", cabecalhos, {
      codigo: gerarCodigoTotp(segredo),
    });
    const { codigosBackup } = await respostaConfirmar.json();

    await chamar("/api/auth/mfa/desativar", cabecalhos, {
      codigo: gerarCodigoTotp(segredo),
    });

    // Reativa o MFA com um segredo novo — os códigos de backup do MFA
    // anterior não devem continuar valendo pro novo.
    const respostaIniciar2 = await chamar("/api/auth/mfa/iniciar", cabecalhos);
    const { segredo: segredo2 } = await respostaIniciar2.json();
    await chamar("/api/auth/mfa/confirmar", cabecalhos, {
      codigo: gerarCodigoTotp(segredo2),
    });

    const loginMfa = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ipAleatorio() },
      body: JSON.stringify({ email: usuario.email, senha: usuario.senha }),
    });
    const { mfaToken } = await loginMfa.json();

    const respostaBackupAntigo = await chamar("/api/auth/mfa/backup", {}, {
      mfaToken,
      codigo: codigosBackup[0],
    });
    expect(respostaBackupAntigo.status).toBe(401);

    const usuarioDb = await prisma.usuario.findUniqueOrThrow({ where: { email: usuario.email } });
    const log = await prisma.logAuditoria.findFirst({
      where: { usuarioId: usuarioDb.id, evento: "codigos_backup_invalidados" },
    });
    expect(log).not.toBeNull();
  });
});
