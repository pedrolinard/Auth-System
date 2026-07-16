import { afterAll, describe, expect, it } from "vitest";
import { apagarUsuariosTeste, BASE_URL, criarUsuarioTeste, loginTeste } from "../helpers";

const emailsCriados: string[] = [];

describe("Proteção CSRF (double-submit cookie)", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("sem cookie CSRF (cliente via Bearer, sem Cookie nenhum) a checagem é pulada", async () => {
    const usuario = await criarUsuarioTeste("csrf-bearer");
    emailsCriados.push(usuario.email);
    const { cookies } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/mfa/iniciar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cookies.tokenAcesso}` },
      // sem header Cookie nenhum — simula um cliente não-navegador
    });

    expect(resposta.status).toBe(200);
  });

  it("com cookie CSRF presente, header ausente é bloqueado (403)", async () => {
    const usuario = await criarUsuarioTeste("csrf-sem-header");
    emailsCriados.push(usuario.email);
    const { cookies } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/mfa/iniciar`, {
      method: "POST",
      headers: {
        Cookie: `tokenAcesso=${cookies.tokenAcesso}; csrfToken=${cookies.csrfToken}`,
      },
    });

    expect(resposta.status).toBe(403);
  });

  it("com cookie CSRF presente, header divergente é bloqueado (403)", async () => {
    const usuario = await criarUsuarioTeste("csrf-header-errado");
    emailsCriados.push(usuario.email);
    const { cookies } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/mfa/iniciar`, {
      method: "POST",
      headers: {
        Cookie: `tokenAcesso=${cookies.tokenAcesso}; csrfToken=${cookies.csrfToken}`,
        "X-CSRF-Token": "valor-errado",
      },
    });

    expect(resposta.status).toBe(403);
  });

  it("header com o MESMO tamanho do cookie mas valor diferente é bloqueado (403)", async () => {
    // Exercita o caminho do timingSafeEqual de verdade (não só a checagem de
    // tamanho que vem antes) — o token real e o forjado precisam ter o
    // mesmo comprimento pra isso.
    const usuario = await criarUsuarioTeste("csrf-mesmo-tamanho");
    emailsCriados.push(usuario.email);
    const { cookies } = await loginTeste(usuario.email, usuario.senha);

    const tokenForjado = cookies.csrfToken
      .split("")
      .reverse()
      .join("");
    expect(tokenForjado).toHaveLength(cookies.csrfToken.length);
    expect(tokenForjado).not.toBe(cookies.csrfToken);

    const resposta = await fetch(`${BASE_URL}/api/auth/mfa/iniciar`, {
      method: "POST",
      headers: {
        Cookie: `tokenAcesso=${cookies.tokenAcesso}; csrfToken=${cookies.csrfToken}`,
        "X-CSRF-Token": tokenForjado,
      },
    });

    expect(resposta.status).toBe(403);
  });

  it("com cookie e header CSRF batendo, a mutação é permitida", async () => {
    const usuario = await criarUsuarioTeste("csrf-ok");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/mfa/iniciar`, {
      method: "POST",
      headers: cabecalhos,
    });

    expect(resposta.status).toBe(200);
  });
});
