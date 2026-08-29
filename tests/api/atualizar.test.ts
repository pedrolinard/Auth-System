import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  apagarUsuariosTeste,
  BASE_URL,
  cabecalhoCookie,
  criarUsuarioTeste,
  extrairTodosCookies,
  ipAleatorio,
  loginTeste,
} from "../helpers";

const emailsCriados: string[] = [];

async function atualizar(cabecalhos: Record<string, string>) {
  return fetch(`${BASE_URL}/api/auth/atualizar`, {
    method: "POST",
    headers: cabecalhos,
  });
}

describe("POST /api/auth/atualizar — rotação e detecção de reuso", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("rotaciona o token de atualização e invalida o anterior", async () => {
    const usuario = await criarUsuarioTeste("atualizar-rotacao");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const respostaRotacao = await atualizar(cabecalhos);
    expect(respostaRotacao.status).toBe(200);

    // O token antigo (usado na rotação acima) não pode mais ser reusado.
    const respostaReuso = await atualizar(cabecalhos);
    expect(respostaReuso.status).toBe(401);
  });

  it("reuso de um token já rotacionado derruba toda a família de sessões do usuário", async () => {
    const usuario = await criarUsuarioTeste("atualizar-reuso");
    emailsCriados.push(usuario.email);
    const loginInicial = await loginTeste(usuario.email, usuario.senha);

    // Rotaciona uma vez — o token do login inicial passa a estar revogado,
    // e um novo par de cookies é emitido.
    const respostaRotacao = await atualizar(loginInicial.cabecalhos);
    expect(respostaRotacao.status).toBe(200);
    const cookiesNovos = extrairTodosCookies(respostaRotacao);
    const cabecalhosNovos = {
      Cookie: cabecalhoCookie(cookiesNovos),
      "X-CSRF-Token": cookiesNovos.csrfToken,
    };

    // Reusa o token antigo (já revogado pela rotação acima) — deve ser
    // detectado como reuso e derrubar a família inteira, não só esse token.
    const respostaReuso = await atualizar(loginInicial.cabecalhos);
    expect(respostaReuso.status).toBe(401);

    // Prova real: o token novo, emitido pela rotação legítima, também para
    // de funcionar — a sessão "boa" foi derrubada junto com a reusada.
    const respostaComTokenNovo = await atualizar(cabecalhosNovos);
    expect(respostaComTokenNovo.status).toBe(401);

    const usuarioDb = await prisma.usuario.findUnique({ where: { email: usuario.email } });
    const logReuso = await prisma.logAuditoria.findFirst({
      where: { usuarioId: usuarioDb!.id, evento: "reuso_token_detectado" },
    });
    expect(logReuso).not.toBeNull();
  });

  it("bloqueia com 429 após muitas renovações com token inválido do mesmo IP", async () => {
    const usuario = await criarUsuarioTeste("atualizar-ratelimit");
    emailsCriados.push(usuario.email);
    const { cookies } = await loginTeste(usuario.email, usuario.senha);
    const ip = ipAleatorio();

    // CSRF válido (do login), mas o token de atualização é lixo — cai no
    // caminho de "token inválido", que é o que o rate limit conta.
    const cabecalhos = {
      Cookie: cabecalhoCookie({ ...cookies, tokenAtualizacao: "lixo" }),
      "X-CSRF-Token": cookies.csrfToken,
      "X-Forwarded-For": ip,
    };

    for (let i = 0; i < 20; i++) {
      const resposta = await atualizar(cabecalhos);
      expect(resposta.status).toBe(401);
    }

    const bloqueada = await atualizar(cabecalhos);
    expect(bloqueada.status).toBe(429);
  }, 45000);
});
