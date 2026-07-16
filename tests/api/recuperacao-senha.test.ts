import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { gerarTokenRedefinicaoSenha } from "@/lib/token";
import {
  apagarUsuariosTeste,
  BASE_URL,
  criarUsuarioTeste,
  ipAleatorio,
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
    const ip = ipAleatorio();

    const respostaExistente = await fetch(`${BASE_URL}/api/auth/esqueci-senha`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: JSON.stringify({ email: usuario.email }),
    });
    const respostaInexistente = await fetch(`${BASE_URL}/api/auth/esqueci-senha`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
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
    const ip = ipAleatorio();

    // Sessão ativa ANTES da redefinição — deve cair depois.
    const sessaoAntiga = await loginTeste(usuario.email, usuario.senha, ip);

    const token = await gerarTokenRedefinicaoSenha(
      (await prisma.usuario.findUniqueOrThrow({ where: { email: usuario.email } })).id,
    );
    const novaSenha = "NovaSenhaForte456!";

    const respostaRedefinir = await fetch(`${BASE_URL}/api/auth/redefinir-senha`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
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
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: JSON.stringify({ email: usuario.email, senha: usuario.senha }),
    });
    expect(loginComSenhaAntiga.status).toBe(401);

    const loginComSenhaNova = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: JSON.stringify({ email: usuario.email, senha: novaSenha }),
    });
    expect(loginComSenhaNova.status).toBe(200);
  });

  it("rejeita token inválido com 401", async () => {
    const resposta = await fetch(`${BASE_URL}/api/auth/redefinir-senha`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ipAleatorio() },
      body: JSON.stringify({ token: "token-invalido", novaSenha: "OutraSenha123!" }),
    });
    expect(resposta.status).toBe(401);
  });

  it("token de redefinição é de uso único: a segunda tentativa com o mesmo link falha", async () => {
    const usuario = await criarUsuarioTeste("redefinir-uso-unico");
    emailsCriados.push(usuario.email);
    const ip = ipAleatorio();

    const token = await gerarTokenRedefinicaoSenha(
      (await prisma.usuario.findUniqueOrThrow({ where: { email: usuario.email } })).id,
    );

    async function redefinir(novaSenha: string) {
      return fetch(`${BASE_URL}/api/auth/redefinir-senha`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
        body: JSON.stringify({ token, novaSenha }),
      });
    }

    const primeiraTentativa = await redefinir("PrimeiraSenhaNova1!");
    expect(primeiraTentativa.status).toBe(200);

    // Mesmo token, ainda dentro da janela de validade do JWT — mas a senha
    // já foi trocada, então o link não pode ser usado de novo.
    const segundaTentativa = await redefinir("SegundaSenhaNova2!");
    expect(segundaTentativa.status).toBe(401);

    // Confirma que a senha efetivamente em vigor é a da primeira tentativa.
    const loginComPrimeiraSenha = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: JSON.stringify({ email: usuario.email, senha: "PrimeiraSenhaNova1!" }),
    });
    expect(loginComPrimeiraSenha.status).toBe(200);
  });
});
