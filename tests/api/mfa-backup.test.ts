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

// Ativa o MFA de um usuário recém-criado e retorna os códigos de backup
// emitidos na confirmação, junto com o segredo TOTP (útil pra alguns testes
// que também precisam gerar um código de desafio válido).
async function ativarMfaEObterCodigosBackup(prefixo: string) {
  const usuario = await criarUsuarioTeste(prefixo);
  emailsCriados.push(usuario.email);
  const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

  const respostaIniciar = await chamar("/api/auth/mfa/iniciar", cabecalhos);
  const { segredo } = await respostaIniciar.json();

  const respostaConfirmar = await chamar("/api/auth/mfa/confirmar", cabecalhos, {
    codigo: gerarCodigoTotp(segredo),
  });
  const { codigosBackup } = await respostaConfirmar.json();

  return { usuario, segredo, codigosBackup: codigosBackup as string[] };
}

async function obterMfaToken(email: string, senha: string, ip = ipAleatorio()) {
  const resposta = await chamar("/api/auth/login", {}, { email, senha }, ip);
  const { mfaToken } = await resposta.json();
  return mfaToken as string;
}

describe("POST /api/auth/mfa/backup", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("login com um código de backup válido cria sessão e informa quantos restam", async () => {
    const { usuario, codigosBackup } = await ativarMfaEObterCodigosBackup("backup-login-ok");
    const mfaToken = await obterMfaToken(usuario.email, usuario.senha);

    const resposta = await chamar("/api/auth/mfa/backup", {}, {
      mfaToken,
      codigo: codigosBackup[0],
    });

    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(corpo.tokenAcesso).toBeTruthy();
    expect(corpo.codigosBackupRestantes).toBe(9);

    const usuarioDb = await prisma.usuario.findUniqueOrThrow({ where: { email: usuario.email } });
    const logSucesso = await prisma.logAuditoria.findFirst({
      where: { usuarioId: usuarioDb.id, evento: "mfa_backup_sucesso" },
    });
    expect(logSucesso).not.toBeNull();
  });

  it("rejeita reuso do mesmo código de backup (uso único)", async () => {
    const { usuario, codigosBackup } = await ativarMfaEObterCodigosBackup("backup-reuso");

    const mfaTokenPrimeiro = await obterMfaToken(usuario.email, usuario.senha);
    const primeira = await chamar("/api/auth/mfa/backup", {}, {
      mfaToken: mfaTokenPrimeiro,
      codigo: codigosBackup[1],
    });
    expect(primeira.status).toBe(200);

    const mfaTokenSegundo = await obterMfaToken(usuario.email, usuario.senha);
    const segunda = await chamar("/api/auth/mfa/backup", {}, {
      mfaToken: mfaTokenSegundo,
      codigo: codigosBackup[1],
    });
    expect(segunda.status).toBe(401);

    const usuarioDb = await prisma.usuario.findUniqueOrThrow({ where: { email: usuario.email } });
    const logFalha = await prisma.logAuditoria.findFirst({
      where: { usuarioId: usuarioDb.id, evento: "mfa_backup_falha" },
    });
    expect(logFalha).not.toBeNull();
  });

  it("rejeita código de backup inventado com 401", async () => {
    const { usuario } = await ativarMfaEObterCodigosBackup("backup-invalido");
    const mfaToken = await obterMfaToken(usuario.email, usuario.senha);

    const resposta = await chamar("/api/auth/mfa/backup", {}, {
      mfaToken,
      codigo: "ZZZZZ-ZZZZZ",
    });

    expect(resposta.status).toBe(401);
  });

  it("rejeita mfaToken inválido/expirado com a mesma mensagem genérica", async () => {
    const resposta = await chamar("/api/auth/mfa/backup", {}, {
      mfaToken: "token-invalido",
      codigo: "A7K9M-3PXQ2",
    });

    expect(resposta.status).toBe(401);
    const corpo = await resposta.json();
    expect(corpo.erro).toBe("Desafio de MFA inválido ou expirado. Faça login novamente.");
  });

  it("rejeita formato de código inválido com 400", async () => {
    const { usuario } = await ativarMfaEObterCodigosBackup("backup-formato");
    const mfaToken = await obterMfaToken(usuario.email, usuario.senha);

    const resposta = await chamar("/api/auth/mfa/backup", {}, {
      mfaToken,
      codigo: "curto",
    });

    expect(resposta.status).toBe(400);
  });

  it("bloqueia com 429 após estourar tentativas de código de backup errado do mesmo IP", async () => {
    const { usuario } = await ativarMfaEObterCodigosBackup("backup-rate-limit");
    const ip = ipAleatorio();

    async function tentarCodigoErrado() {
      const mfaToken = await obterMfaToken(usuario.email, usuario.senha, ip);
      return chamar("/api/auth/mfa/backup", {}, { mfaToken, codigo: "ZZZZZ-ZZZZZ" }, ip);
    }

    for (let i = 0; i < 5; i++) {
      const resposta = await tentarCodigoErrado();
      expect(resposta.status).toBe(401);
    }

    const sexta = await tentarCodigoErrado();
    expect(sexta.status).toBe(429);
  }, 45000);
});
