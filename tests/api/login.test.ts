import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  apagarUsuariosTeste,
  BASE_URL,
  criarUsuarioTeste,
  extrairCookie,
  gerarEmailTeste,
  ipAleatorio,
  SENHA_TESTE,
} from "../helpers";

const emailsCriados: string[] = [];

async function login(email: string, senha: string, ip = ipAleatorio()) {
  return fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ email, senha }),
  });
}

describe("POST /api/auth/login", () => {
  let email: string;

  beforeAll(async () => {
    const usuario = await criarUsuarioTeste("login");
    email = usuario.email;
    emailsCriados.push(email);
  });

  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("autentica com credenciais corretas e seta os três cookies httpOnly/CSRF", async () => {
    const resposta = await login(email, SENHA_TESTE);

    expect(resposta.status).toBe(200);
    expect(extrairCookie(resposta, "tokenAcesso")).toBeTruthy();
    expect(extrairCookie(resposta, "tokenAtualizacao")).toBeTruthy();
    expect(extrairCookie(resposta, "csrfToken")).toBeTruthy();
  });

  it("rejeita senha errada com mensagem genérica (401)", async () => {
    const resposta = await login(email, "SenhaErrada999");
    expect(resposta.status).toBe(401);
    const corpo = await resposta.json();
    expect(corpo.erro).toBe("E-mail ou senha inválidos.");
  });

  it("rejeita e-mail inexistente com a MESMA mensagem genérica (não vaza)", async () => {
    const resposta = await login(gerarEmailTeste("nao-existe"), "QualquerSenha1");
    expect(resposta.status).toBe(401);
    const corpo = await resposta.json();
    expect(corpo.erro).toBe("E-mail ou senha inválidos.");
  });

  it("retorna mfaObrigatorio quando o usuário tem MFA ativado", async () => {
    const usuarioMfa = await criarUsuarioTeste("login-mfa");
    emailsCriados.push(usuarioMfa.email);
    await prisma.usuario.update({
      where: { email: usuarioMfa.email },
      data: { mfaAtivado: true, mfaSecret: "JBSWY3DPEHPK3PXP" },
    });

    const resposta = await login(usuarioMfa.email, usuarioMfa.senha);

    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(corpo.mfaObrigatorio).toBe(true);
    expect(corpo.mfaToken).toBeTruthy();
    // Login com MFA pendente não deve setar cookie de sessão ainda.
    expect(extrairCookie(resposta, "tokenAcesso")).toBeNull();
  });
});
