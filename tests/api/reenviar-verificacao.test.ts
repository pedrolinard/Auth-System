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

describe("POST /api/auth/reenviar-verificacao", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("reenvia o token pra quem ainda não verificou o e-mail", async () => {
    const usuario = await criarUsuarioTeste("reenviar-verificacao-ok");
    emailsCriados.push(usuario.email);
    const ip = ipAleatorio();
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha, ip);

    const resposta = await fetch(`${BASE_URL}/api/auth/reenviar-verificacao`, {
      method: "POST",
      headers: { ...cabecalhos, "X-Forwarded-For": ip },
    });
    expect(resposta.status).toBe(200);
  });

  it("rejeita quem já verificou o e-mail com 409", async () => {
    const usuario = await criarUsuarioTeste("reenviar-verificacao-ja-ok");
    emailsCriados.push(usuario.email);
    await prisma.usuario.update({
      where: { email: usuario.email },
      data: { emailVerificado: true },
    });
    const ip = ipAleatorio();
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha, ip);

    const resposta = await fetch(`${BASE_URL}/api/auth/reenviar-verificacao`, {
      method: "POST",
      headers: { ...cabecalhos, "X-Forwarded-For": ip },
    });
    expect(resposta.status).toBe(409);
  });

  it("rejeita requisição não autenticada com 401", async () => {
    const resposta = await fetch(`${BASE_URL}/api/auth/reenviar-verificacao`, {
      method: "POST",
    });
    expect(resposta.status).toBe(401);
  });

  it("bloqueia com 429 após estourar o limite de tentativas do mesmo IP", async () => {
    const usuario = await criarUsuarioTeste("reenviar-verificacao-limite");
    emailsCriados.push(usuario.email);
    const ip = ipAleatorio();
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha, ip);

    async function tentarReenviar() {
      return fetch(`${BASE_URL}/api/auth/reenviar-verificacao`, {
        method: "POST",
        headers: { ...cabecalhos, "X-Forwarded-For": ip },
      });
    }

    for (let i = 0; i < 3; i++) {
      const resposta = await tentarReenviar();
      expect(resposta.status).toBe(200);
    }

    const quarta = await tentarReenviar();
    expect(quarta.status).toBe(429);
  }, 45000);
});
