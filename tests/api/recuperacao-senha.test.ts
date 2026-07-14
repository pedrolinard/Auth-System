import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { gerarTokenRedefinicaoSenha } from "@/lib/token";
import {
  apagarUsuariosTeste,
  BASE_URL,
  criarUsuarioTeste,
  loginTeste,
} from "../helpers";

const emailsCriados: string[] = [];

describe("Recuperação de senha", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("POST /esqueci-senha sempre responde com sucesso genérico (existindo ou não o e-mail)", async () => {
    const usuario = await criarUsuarioTeste("recuperar-existe");
    emailsCriados.push(usuario.email);

    const respostaExistente = await fetch(`${BASE_URL}/api/auth/esqueci-senha`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: usuario.email }),
    });
    const respostaInexistente = await fetch(`${BASE_URL}/api/auth/esqueci-senha`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nao-existe-de-verdade@teste.local" }),
    });

    expect(respostaExistente.status).toBe(200);
    expect(respostaInexistente.status).toBe(200);
    const corpo1 = await respostaExistente.json();
    const corpo2 = await respostaInexistente.json();
    expect(corpo1.mensagem).toBe(corpo2.mensagem);
  });

  it("redefine a senha com um token válido e revoga as sessões antigas", async () => {
    const usuario = await criarUsuarioTeste("redefinir-ok");
    emailsCriados.push(usuario.email);

    // Sessão ativa ANTES da redefinição — deve cair depois.
    const sessaoAntiga = await loginTeste(usuario.email, usuario.senha);

    const token = await gerarTokenRedefinicaoSenha(
      (await prisma.usuario.findUniqueOrThrow({ where: { email: usuario.email } })).id,
    );
    const novaSenha = "NovaSenhaForte456!";

    const respostaRedefinir = await fetch(`${BASE_URL}/api/auth/redefinir-senha`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, novaSenha }),
    });
    expect(respostaRedefinir.status).toBe(200);

    // Sessão antiga não deve mais conseguir renovar.
    const respostaAtualizar = await fetch(`${BASE_URL}/api/auth/atualizar`, {
      method: "POST",
      headers: sessaoAntiga.cabecalhos,
    });
    expect(respostaAtualizar.status).toBe(401);

    // Senha antiga não funciona mais; a nova funciona.
    const loginComSenhaAntiga = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: usuario.email, senha: usuario.senha }),
    });
    expect(loginComSenhaAntiga.status).toBe(401);

    const loginComSenhaNova = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: usuario.email, senha: novaSenha }),
    });
    expect(loginComSenhaNova.status).toBe(200);
  });

  it("rejeita token inválido com 401", async () => {
    const resposta = await fetch(`${BASE_URL}/api/auth/redefinir-senha`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "token-invalido", novaSenha: "OutraSenha123!" }),
    });
    expect(resposta.status).toBe(401);
  });
});
