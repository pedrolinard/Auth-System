import * as OTPAuth from "otpauth";
import { afterAll, describe, expect, it } from "vitest";
import {
  apagarUsuariosTeste,
  BASE_URL,
  criarUsuarioTeste,
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

async function chamar(caminho: string, headers: Record<string, string>, corpo?: object) {
  return fetch(`${BASE_URL}${caminho}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
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
});
