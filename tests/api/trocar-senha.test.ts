import { afterAll, describe, expect, it } from "vitest";
import {
  apagarUsuariosTeste,
  BASE_URL,
  criarUsuarioTeste,
  ipAleatorio,
  loginTeste,
  SENHA_TESTE,
} from "../helpers";

const emailsCriados: string[] = [];

describe("Troca de senha estando logado (PUT /api/auth/senha)", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("troca a senha com a senha atual correta e permite login com a nova", async () => {
    const usuario = await criarUsuarioTeste("trocar-senha-ok");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const novaSenha = "NovaSenhaForte456!";
    const resposta = await fetch(`${BASE_URL}/api/auth/senha`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ senhaAtual: usuario.senha, novaSenha }),
    });
    expect(resposta.status).toBe(200);

    const loginComSenhaAntiga = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: usuario.email, senha: SENHA_TESTE }),
    });
    expect(loginComSenhaAntiga.status).toBe(401);

    const loginComSenhaNova = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: usuario.email, senha: novaSenha }),
    });
    expect(loginComSenhaNova.status).toBe(200);
  });

  it("rejeita com senha atual incorreta", async () => {
    const usuario = await criarUsuarioTeste("trocar-senha-atual-errada");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/senha`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ senhaAtual: "SenhaErrada999!", novaSenha: "OutraSenhaForte789!" }),
    });
    expect(resposta.status).toBe(401);
  });

  it("rejeita nova senha conhecida em vazamentos", async () => {
    const usuario = await criarUsuarioTeste("trocar-senha-vazada");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/senha`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      // "Password1" está entre as senhas mais comuns em vazamentos reais.
      body: JSON.stringify({ senhaAtual: usuario.senha, novaSenha: "Password1" }),
    });
    expect(resposta.status).toBe(400);
  });

  it("mantém a sessão atual viva e derruba as outras", async () => {
    const usuario = await criarUsuarioTeste("trocar-senha-sessoes");
    emailsCriados.push(usuario.email);

    // Dispositivo 1: faz a troca de senha. Dispositivo 2: só logado antes.
    const dispositivo1 = await loginTeste(usuario.email, usuario.senha);
    const dispositivo2 = await loginTeste(usuario.email, usuario.senha);

    const novaSenha = "OutraSenhaForte321!";
    const resposta = await fetch(`${BASE_URL}/api/auth/senha`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...dispositivo1.cabecalhos },
      body: JSON.stringify({ senhaAtual: usuario.senha, novaSenha }),
    });
    expect(resposta.status).toBe(200);

    // Sessão que fez a troca continua valendo.
    const meDispositivo1 = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: dispositivo1.cabecalhos,
    });
    expect(meDispositivo1.status).toBe(200);

    // A outra sessão foi revogada — /atualizar com o refresh token dela falha.
    const atualizarDispositivo2 = await fetch(`${BASE_URL}/api/auth/atualizar`, {
      method: "POST",
      headers: dispositivo2.cabecalhos,
    });
    expect(atualizarDispositivo2.status).toBe(401);
  });

  it("sem autenticação retorna 401", async () => {
    const resposta = await fetch(`${BASE_URL}/api/auth/senha`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senhaAtual: "qualquer", novaSenha: "OutraSenhaForte000!" }),
    });
    expect(resposta.status).toBe(401);
  });

  it("rejeita nova senha igual à atual", async () => {
    const usuario = await criarUsuarioTeste("trocar-senha-igual");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/senha`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ senhaAtual: usuario.senha, novaSenha: usuario.senha }),
    });
    expect(resposta.status).toBe(400);
  });

  it("bloqueia com 429 após estourar tentativas de senha atual errada", async () => {
    const usuario = await criarUsuarioTeste("trocar-senha-rate-limit");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);
    const ip = ipAleatorio();

    async function tentarSenhaErrada() {
      return fetch(`${BASE_URL}/api/auth/senha`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...cabecalhos, "X-Forwarded-For": ip },
        body: JSON.stringify({ senhaAtual: "SenhaErrada999!", novaSenha: "OutraSenhaForte789!" }),
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
