import { afterAll, describe, expect, it } from "vitest";
import {
  apagarUsuariosTeste,
  BASE_URL,
  gerarEmailTeste,
  ipAleatorio,
  SENHA_TESTE,
} from "../helpers";

const emailsCriados: string[] = [];

function proximoEmail(prefixo: string) {
  const email = gerarEmailTeste(prefixo);
  emailsCriados.push(email);
  return email;
}

async function cadastrar(dados: Record<string, unknown>, ip = ipAleatorio()) {
  return fetch(`${BASE_URL}/api/auth/cadastro`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify(dados),
  });
}

describe("POST /api/auth/cadastro", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("cria um usuário novo", async () => {
    const email = proximoEmail("cadastro-sucesso");
    const resposta = await cadastrar({ nome: "Teste", email, senha: SENHA_TESTE });

    expect(resposta.status).toBe(201);
    const corpo = await resposta.json();
    expect(corpo.usuario.email).toBe(email);
    expect(corpo.usuario.id).toBeTruthy();
  });

  it("rejeita e-mail duplicado com 409", async () => {
    const email = proximoEmail("cadastro-duplicado");
    const dados = { nome: "Teste", email, senha: SENHA_TESTE };

    await cadastrar(dados);
    const resposta = await cadastrar(dados);

    expect(resposta.status).toBe(409);
  });

  it("rejeita dados inválidos com 400", async () => {
    const resposta = await cadastrar({ nome: "T", email: "invalido", senha: "123" });
    expect(resposta.status).toBe(400);
  });

  it("rejeita senha com mais de 72 caracteres (limite de bytes do bcrypt)", async () => {
    const email = proximoEmail("cadastro-senha-longa");
    const senhaGigante = `Senha1${"a".repeat(70)}`; // 76 caracteres
    const resposta = await cadastrar({ nome: "Teste", email, senha: senhaGigante });
    expect(resposta.status).toBe(400);
  });

  it("aceita senha de exatamente 72 caracteres", async () => {
    const email = proximoEmail("cadastro-senha-72");
    const senhaNoLimite = `Senha1${"a".repeat(66)}`; // 72 caracteres
    expect(senhaNoLimite).toHaveLength(72);
    const resposta = await cadastrar({ nome: "Teste", email, senha: senhaNoLimite });
    expect(resposta.status).toBe(201);
  });
});
