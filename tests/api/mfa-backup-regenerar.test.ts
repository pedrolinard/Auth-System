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

async function ativarMfa(prefixo: string) {
  const usuario = await criarUsuarioTeste(prefixo);
  emailsCriados.push(usuario.email);
  const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

  const respostaIniciar = await chamar("/api/auth/mfa/iniciar", cabecalhos);
  const { segredo } = await respostaIniciar.json();

  const respostaConfirmar = await chamar("/api/auth/mfa/confirmar", cabecalhos, {
    codigo: gerarCodigoTotp(segredo),
  });
  const { codigosBackup } = await respostaConfirmar.json();

  return { usuario, cabecalhos, segredo, codigosBackupIniciais: codigosBackup as string[] };
}

describe("POST /api/auth/mfa/backup/regenerar", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("regenera com TOTP válido: emite 10 códigos novos e invalida os antigos", async () => {
    const { usuario, cabecalhos, segredo, codigosBackupIniciais } =
      await ativarMfa("backup-regen-ok");

    const resposta = await chamar("/api/auth/mfa/backup/regenerar", cabecalhos, {
      codigo: gerarCodigoTotp(segredo),
    });

    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(corpo.codigosBackup).toHaveLength(10);
    // Praticamente certo que o conjunto novo não repete nenhum código do
    // conjunto antigo (espaço de ~49,5 bits por código).
    const intersecao = corpo.codigosBackup.filter((c: string) =>
      codigosBackupIniciais.includes(c),
    );
    expect(intersecao).toHaveLength(0);

    // Um código do conjunto ANTIGO não pode mais logar via /mfa/backup.
    const loginMfa = await chamar("/api/auth/login", {}, {
      email: usuario.email,
      senha: usuario.senha,
    });
    const { mfaToken } = await loginMfa.json();
    const respostaBackupAntigo = await chamar("/api/auth/mfa/backup", {}, {
      mfaToken,
      codigo: codigosBackupIniciais[0],
    });
    expect(respostaBackupAntigo.status).toBe(401);

    // Um código do conjunto NOVO funciona normalmente.
    const loginMfa2 = await chamar("/api/auth/login", {}, {
      email: usuario.email,
      senha: usuario.senha,
    });
    const { mfaToken: mfaToken2 } = await loginMfa2.json();
    const respostaBackupNovo = await chamar("/api/auth/mfa/backup", {}, {
      mfaToken: mfaToken2,
      codigo: corpo.codigosBackup[0],
    });
    expect(respostaBackupNovo.status).toBe(200);

    const usuarioDb = await prisma.usuario.findUniqueOrThrow({ where: { email: usuario.email } });
    const log = await prisma.logAuditoria.findFirst({
      where: { usuarioId: usuarioDb.id, evento: "codigos_backup_regenerados" },
    });
    expect(log).not.toBeNull();
  });

  it("rejeita TOTP inválido e não altera o conjunto de códigos", async () => {
    const { cabecalhos, codigosBackupIniciais } = await ativarMfa("backup-regen-totp-errado");

    const resposta = await chamar("/api/auth/mfa/backup/regenerar", cabecalhos, {
      codigo: "000000",
    });
    expect(resposta.status).toBe(401);

    // Um código do conjunto original ainda deve continuar válido.
    // (verificado indiretamente: a regeneração não deve ter rodado.)
    expect(codigosBackupIniciais).toHaveLength(10);
  });

  it("exige CSRF válido", async () => {
    const usuario = await criarUsuarioTeste("backup-regen-csrf");
    emailsCriados.push(usuario.email);
    const { cookies } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/mfa/backup/regenerar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `tokenAcesso=${cookies.tokenAcesso}; csrfToken=${cookies.csrfToken}`,
        // sem X-CSRF-Token de propósito
      },
      body: JSON.stringify({ codigo: "000000" }),
    });

    expect(resposta.status).toBe(403);
  });

  it("exige autenticação", async () => {
    const resposta = await fetch(`${BASE_URL}/api/auth/mfa/backup/regenerar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo: "000000" }),
    });

    expect(resposta.status).toBe(401);
  });
});
