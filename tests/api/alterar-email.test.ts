import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { gerarTokenAlteracaoEmail } from "@/lib/token";
import { apagarUsuariosTeste, BASE_URL, criarUsuarioTeste, gerarEmailTeste, loginTeste } from "../helpers";

const emailsCriados: string[] = [];

describe("Alterar e-mail (confirmação em duas etapas)", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("solicitar a troca não altera o e-mail até confirmar o link", async () => {
    const usuario = await criarUsuarioTeste("alterar-email-pedido");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);
    const novoEmail = gerarEmailTeste("alterar-email-novo");
    emailsCriados.push(novoEmail);

    const resposta = await fetch(`${BASE_URL}/api/auth/alterar-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ novoEmail }),
    });
    expect(resposta.status).toBe(200);

    const usuarioDb = await prisma.usuario.findUniqueOrThrow({ where: { email: usuario.email } });
    expect(usuarioDb.email).toBe(usuario.email);
  });

  it("confirmar o link muda o e-mail e marca como verificado", async () => {
    const usuario = await criarUsuarioTeste("alterar-email-confirmar");
    emailsCriados.push(usuario.email);
    const registro = await prisma.usuario.findUniqueOrThrow({ where: { email: usuario.email } });
    const novoEmail = gerarEmailTeste("alterar-email-confirmado");
    emailsCriados.push(novoEmail);

    const token = await gerarTokenAlteracaoEmail(registro.id, novoEmail);
    const resposta = await fetch(`${BASE_URL}/api/auth/confirmar-alteracao-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(corpo.novoEmail).toBe(novoEmail);

    const usuarioDb = await prisma.usuario.findUniqueOrThrow({ where: { id: registro.id } });
    expect(usuarioDb.email).toBe(novoEmail);
    expect(usuarioDb.emailVerificado).toBe(true);

    // Login com o e-mail antigo não funciona mais.
    const loginAntigo = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: usuario.email, senha: usuario.senha }),
    });
    expect(loginAntigo.status).toBe(401);

    // Login com o e-mail novo funciona.
    const loginNovo = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: novoEmail, senha: usuario.senha }),
    });
    expect(loginNovo.status).toBe(200);
  });

  it("rejeita quando o novo e-mail já está em uso por outra conta", async () => {
    const usuario = await criarUsuarioTeste("alterar-email-conflito-a");
    const outro = await criarUsuarioTeste("alterar-email-conflito-b");
    emailsCriados.push(usuario.email, outro.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/alterar-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ novoEmail: outro.email }),
    });
    expect(resposta.status).toBe(409);
  });

  it("rejeita pedir troca para o mesmo e-mail atual", async () => {
    const usuario = await criarUsuarioTeste("alterar-email-mesmo");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/alterar-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ novoEmail: usuario.email }),
    });
    expect(resposta.status).toBe(400);
  });

  it("rejeita um token de confirmação inválido", async () => {
    const resposta = await fetch(`${BASE_URL}/api/auth/confirmar-alteracao-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "token-invalido" }),
    });
    expect(resposta.status).toBe(401);
  });

  it("sem autenticação retorna 401 ao pedir a troca", async () => {
    const resposta = await fetch(`${BASE_URL}/api/auth/alterar-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ novoEmail: "qualquer@teste.local" }),
    });
    expect(resposta.status).toBe(401);
  });
});
