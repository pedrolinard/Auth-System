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

describe("Autoatendimento LGPD (GET/DELETE /api/auth/minha-conta)", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("sem autenticação retorna 401 tanto pra exportar quanto pra excluir", async () => {
    const respostaExportar = await fetch(`${BASE_URL}/api/auth/minha-conta`);
    expect(respostaExportar.status).toBe(401);

    const respostaExcluir = await fetch(`${BASE_URL}/api/auth/minha-conta`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha: "qualquer" }),
    });
    expect(respostaExcluir.status).toBe(401);
  });

  it("exporta os próprios dados sem vazar hash de senha nem segredo de MFA", async () => {
    const usuario = await criarUsuarioTeste("minha-conta-exportar");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/minha-conta`, {
      headers: cabecalhos,
    });
    expect(resposta.status).toBe(200);

    const corpo = await resposta.json();
    expect(corpo.dadosPessoais.email).toBe(usuario.email);
    expect(corpo.dadosPessoais).not.toHaveProperty("senhaHash");
    expect(corpo.dadosPessoais).not.toHaveProperty("mfaSecret");
    expect(Array.isArray(corpo.sessoes)).toBe(true);
    expect(Array.isArray(corpo.logsAuditoria)).toBe(true);
    // A sessão usada pra chamar a rota já deve aparecer no próprio export.
    expect(corpo.sessoes.length).toBeGreaterThan(0);
    expect(JSON.stringify(corpo)).not.toContain(usuario.senha);
  });

  it("exclui a própria conta com a senha correta e derruba a sessão", async () => {
    const usuario = await criarUsuarioTeste("minha-conta-excluir-ok");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/minha-conta`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ senha: usuario.senha }),
    });
    expect(resposta.status).toBe(200);

    const registroApagado = await prisma.usuario.findUnique({ where: { email: usuario.email } });
    expect(registroApagado).toBeNull();

    const loginApagado = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: usuario.email, senha: usuario.senha }),
    });
    expect(loginApagado.status).toBe(401);
  });

  it("rejeita exclusão com senha incorreta e mantém a conta", async () => {
    const usuario = await criarUsuarioTeste("minha-conta-excluir-senha-errada");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/minha-conta`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ senha: "SenhaErrada999!" }),
    });
    expect(resposta.status).toBe(401);

    const registroAinda = await prisma.usuario.findUnique({ where: { email: usuario.email } });
    expect(registroAinda).not.toBeNull();
  });

  it("bloqueia exclusão sem o token CSRF", async () => {
    const usuario = await criarUsuarioTeste("minha-conta-sem-csrf");
    emailsCriados.push(usuario.email);
    const { cookies } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/minha-conta`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Cookie: `tokenAcesso=${cookies.tokenAcesso}; csrfToken=${cookies.csrfToken}`,
      },
      body: JSON.stringify({ senha: usuario.senha }),
    });
    expect(resposta.status).toBe(403);
  });

  it("bloqueia com 429 após estourar tentativas de senha errada", async () => {
    const usuario = await criarUsuarioTeste("minha-conta-rate-limit");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);
    const ip = ipAleatorio();

    async function tentarSenhaErrada() {
      return fetch(`${BASE_URL}/api/auth/minha-conta`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...cabecalhos, "X-Forwarded-For": ip },
        body: JSON.stringify({ senha: "SenhaErrada999!" }),
      });
    }

    for (let i = 0; i < 5; i++) {
      const resposta = await tentarSenhaErrada();
      expect(resposta.status).toBe(401);
    }

    const sexta = await tentarSenhaErrada();
    expect(sexta.status).toBe(429);
  }, 45000);
});
