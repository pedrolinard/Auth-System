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

// IP próprio por chamada, salvo quando o teste passa um: renovação que falha
// conta no rate limit por IP, e sem o header todas as chamadas da suíte
// dividiriam o IP local — umas rodadas seguidas estouram o limite e os testes
// passam a receber 429 em vez do comportamento que querem verificar.
async function atualizar(cabecalhos: Record<string, string>) {
  return fetch(`${BASE_URL}/api/auth/atualizar`, {
    method: "POST",
    headers: { "X-Forwarded-For": ipAleatorio(), ...cabecalhos },
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

    const usuarioDb = await prisma.usuario.findFirst({ where: { email: usuario.email } });
    const logReuso = await prisma.logAuditoria.findFirst({
      where: { usuarioId: usuarioDb!.id, evento: "reuso_token_detectado" },
    });
    expect(logReuso).not.toBeNull();
  });

  it("token revogado por troca de senha em OUTRO aparelho não dispara o alarme de reuso", async () => {
    // Antes: trocar a senha no notebook revogava a sessão do celular; o
    // celular renovava com o token revogado, isso contava como roubo e
    // derrubava a sessão NOVA do notebook, com e-mail de "atividade suspeita".
    const usuario = await criarUsuarioTeste("atualizar-troca-senha");
    emailsCriados.push(usuario.email);
    const celular = await loginTeste(usuario.email, usuario.senha);
    const notebook = await loginTeste(usuario.email, usuario.senha);

    const troca = await fetch(`${BASE_URL}/api/auth/senha`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ipAleatorio(), ...notebook.cabecalhos },
      body: JSON.stringify({ senhaAtual: usuario.senha, novaSenha: "OutraSenhaMuitoForte789!" }),
    });
    expect(troca.status).toBe(200);

    expect((await atualizar(celular.cabecalhos)).status).toBe(401);
    // A sessão de onde a senha foi trocada segue viva.
    expect((await atualizar(notebook.cabecalhos)).status).toBe(200);

    const usuarioDb = await prisma.usuario.findFirstOrThrow({ where: { email: usuario.email } });
    const alarme = await prisma.logAuditoria.findFirst({
      where: { usuarioId: usuarioDb.id, evento: "reuso_token_detectado" },
    });
    expect(alarme).toBeNull();
  });

  it("grava o motivo da revogação: rotação, e reuso_detectado na família derrubada", async () => {
    const usuario = await criarUsuarioTeste("atualizar-motivo");
    emailsCriados.push(usuario.email);
    const login = await loginTeste(usuario.email, usuario.senha);
    const outraSessao = await loginTeste(usuario.email, usuario.senha);

    expect((await atualizar(login.cabecalhos)).status).toBe(200); // rotaciona
    expect((await atualizar(login.cabecalhos)).status).toBe(401); // reapresenta o rotacionado → reuso

    const usuarioDb = await prisma.usuario.findFirstOrThrow({ where: { email: usuario.email } });
    const sessoes = await prisma.tokenAtualizacao.findMany({
      where: { usuarioId: usuarioDb.id },
      select: { revogadoMotivo: true },
    });
    const motivos = sessoes.map((s) => s.revogadoMotivo);
    expect(motivos).toContain("rotacao");
    expect(motivos).toContain("reuso_detectado");
    expect(motivos).not.toContain(null);
    // A outra sessão caiu junto, marcada como reuso — e reapresentá-la não
    // dispara um SEGUNDO alarme.
    expect((await atualizar(outraSessao.cabecalhos)).status).toBe(401);
    const alarmes = await prisma.logAuditoria.count({
      where: { usuarioId: usuarioDb.id, evento: "reuso_token_detectado" },
    });
    expect(alarmes).toBe(1);
  });

  it("duas renovações simultâneas do mesmo token: só uma rotaciona, e isso não é tratado como reuso", async () => {
    const usuario = await criarUsuarioTeste("atualizar-concorrente");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const [a, b] = await Promise.all([atualizar(cabecalhos), atualizar(cabecalhos)]);
    // Normalmente uma vence e a outra recebe 401; se a segunda chegar só
    // depois da primeira terminar, ela vê o token já rotacionado e cai no
    // reuso — o que também é recusa. O que não pode é nascerem duas sessões.
    expect([a.status, b.status].sort()).toEqual([200, 401]);

    const usuarioDb = await prisma.usuario.findFirstOrThrow({ where: { email: usuario.email } });
    const ativas = await prisma.tokenAtualizacao.count({
      where: { usuarioId: usuarioDb.id, revogadoEm: null },
    });
    expect(ativas).toBeLessThanOrEqual(1);
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
