import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { BASE_URL, SENHA_TESTE, gerarEmailTeste, ipAleatorio } from "../helpers";

// Os critérios de saída da Fase 00: o que precisa ser verdade pra dizer que
// identidade por aplicação está de pé. Cada teste aqui corresponde a um item
// da lista — se um deles cair, a fundação do provedor não está fechada.

const aplicacoesCriadas: string[] = [];
const emailsCriados: string[] = [];

async function criarAplicacao(nome: string) {
  const aplicacao = await prisma.aplicacao.create({
    data: {
      nome,
      clientId: `app_teste_${Math.random().toString(36).slice(2, 12)}`,
      origens: [],
      ativa: true,
    },
    select: { id: true, clientId: true },
  });
  aplicacoesCriadas.push(aplicacao.id);
  return aplicacao;
}

async function cadastrar(email: string, clientId?: string, ip = ipAleatorio()) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Forwarded-For": ip,
  };
  if (clientId) headers["x-aplicacao-id"] = clientId;

  return fetch(`${BASE_URL}/api/auth/cadastro`, {
    method: "POST",
    headers,
    body: JSON.stringify({ nome: "Usuário de teste", email, senha: SENHA_TESTE }),
  });
}

async function logar(email: string, clientId?: string, senha = SENHA_TESTE, ip = ipAleatorio()) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Forwarded-For": ip,
  };
  if (clientId) headers["x-aplicacao-id"] = clientId;

  return fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, senha }),
  });
}

afterAll(async () => {
  await prisma.usuario.deleteMany({ where: { email: { in: emailsCriados } } });
  await prisma.organizacao.deleteMany({ where: { aplicacaoId: { in: aplicacoesCriadas } } });
  await prisma.aplicacao.deleteMany({ where: { id: { in: aplicacoesCriadas } } });
});

describe("Identidade por aplicação", () => {
  it("o mesmo e-mail existe em duas aplicações, e cada uma só enxerga a sua", async () => {
    const appA = await criarAplicacao("Cliente A");
    const appB = await criarAplicacao("Cliente B");
    // O caso que era impossível antes: `email @unique` global fazia o segundo
    // cadastro devolver 409.
    const email = gerarEmailTeste("mesma-conta-duas-apps");
    emailsCriados.push(email);

    expect((await cadastrar(email, appA.clientId)).status).toBe(201);
    expect((await cadastrar(email, appB.clientId)).status).toBe(201);

    const contas = await prisma.usuario.findMany({
      where: { email },
      select: { aplicacaoId: true },
    });
    expect(contas).toHaveLength(2);
    expect(new Set(contas.map((c) => c.aplicacaoId))).toEqual(new Set([appA.id, appB.id]));

    // E são contas de verdade, separadas: cada login devolve o token da conta
    // da SUA aplicação.
    const loginA = await logar(email, appA.clientId);
    expect(loginA.status).toBe(200);
    const loginB = await logar(email, appB.clientId);
    expect(loginB.status).toBe(200);
  });

  it("continua recusando o mesmo e-mail duas vezes DENTRO da mesma aplicação", async () => {
    const app = await criarAplicacao("Cliente duplicata");
    const email = gerarEmailTeste("duplicata-mesma-app");
    emailsCriados.push(email);

    expect((await cadastrar(email, app.clientId)).status).toBe(201);
    // O 409 não sumiu — ele só passou a valer por aplicação, que é a diferença
    // entre isolar clientes e simplesmente afrouxar a unicidade.
    expect((await cadastrar(email, app.clientId)).status).toBe(409);
  });

  it("senha certa na aplicação errada não entra", async () => {
    const appA = await criarAplicacao("Cliente A senha");
    const appB = await criarAplicacao("Cliente B senha");
    const email = gerarEmailTeste("senha-app-errada");
    emailsCriados.push(email);

    expect((await cadastrar(email, appA.clientId)).status).toBe(201);

    // Credencial válida, aplicação que não tem essa conta: 401, e a resposta é
    // a mesma de e-mail inexistente — dizer "essa conta é de outro cliente"
    // confirmaria a existência dela lá.
    const resposta = await logar(email, appB.clientId);
    expect(resposta.status).toBe(401);
  });

  it("client id desconhecido é 400, não 401", async () => {
    // Não é falha de autenticação do usuário — é a aplicação que não pode
    // falar com o provedor. Confundir os dois faria o SDK tentar renovar
    // token num cenário onde renovar não resolve nada.
    const resposta = await logar(gerarEmailTeste("app-inexistente"), "app_que_nao_existe");
    expect(resposta.status).toBe(400);
  });

  it("aplicação desativada para de autenticar", async () => {
    const app = await criarAplicacao("Cliente desativado");
    const email = gerarEmailTeste("app-desativada");
    emailsCriados.push(email);
    expect((await cadastrar(email, app.clientId)).status).toBe(201);

    await prisma.aplicacao.update({ where: { id: app.id }, data: { ativa: false } });

    // Efeito imediato porque o servidor de teste roda com
    // APLICACAO_CACHE_TTL_MS=0. Em produção o cache atrasa isso em até 30s —
    // um teste que não pudesse desligar o cache teria que dormir meio minuto
    // ou não verificaria nada.
    const resposta = await logar(email, app.clientId);
    expect(resposta.status).toBe(400);
  });
});

describe("Rate limit por aplicação", () => {
  it("falhas de login na aplicação A não consomem o limite do mesmo e-mail na B", async () => {
    const appA = await criarAplicacao("Cliente A limite");
    const appB = await criarAplicacao("Cliente B limite");
    const email = gerarEmailTeste("limite-cruzado");
    emailsCriados.push(email);

    expect((await cadastrar(email, appA.clientId)).status).toBe(201);
    expect((await cadastrar(email, appB.clientId)).status).toBe(201);

    // Estoura o limite por CONTA na aplicação A (20 falhas na janela). Cada
    // tentativa de um IP diferente, pra não bater no limite por IP antes.
    for (let i = 0; i < 21; i++) {
      await logar(email, appA.clientId, "SenhaErrada123!", ipAleatorio());
    }
    const bloqueadoEmA = await logar(email, appA.clientId, SENHA_TESTE, ipAleatorio());
    expect(bloqueadoEmA.status).toBe(429);

    // A conta do outro cliente, com o MESMO endereço, segue intacta. Antes da
    // aplicação entrar na chave do contador, este login também dava 429 — um
    // cliente derrubava o usuário do outro só martelando o e-mail.
    const livreEmB = await logar(email, appB.clientId, SENHA_TESTE, ipAleatorio());
    expect(livreEmB.status).toBe(200);
  });
});

describe("Passkeys entre aplicações", () => {
  it("passkey registrada na aplicação A não é aceita na B", async () => {
    const appA = await criarAplicacao("Cliente A passkey");
    const appB = await criarAplicacao("Cliente B passkey");
    const email = gerarEmailTeste("passkey-app-cruzada");
    emailsCriados.push(email);
    expect((await cadastrar(email, appA.clientId)).status).toBe(201);

    const usuario = await prisma.usuario.findFirstOrThrow({
      where: { email, aplicacaoId: appA.id },
      select: { id: true },
    });

    // Credencial inserida direto: o que está sendo verificado aqui é a trava
    // de aplicação, que roda ANTES da verificação criptográfica — chegar até
    // ela por um authenticator de verdade exigiria um browser (é o que o E2E
    // com virtual authenticator faz) e não mudaria o que este teste afirma.
    const credentialId = `cred-teste-${Math.random().toString(36).slice(2, 14)}`;
    await prisma.passkeyCredencial.create({
      data: {
        usuarioId: usuario.id,
        credentialId,
        publicKey: Buffer.from("chave-publica-de-teste").toString("base64"),
        contador: 0,
        transportes: ["internal"],
      },
    });

    const opcoes = await fetch(`${BASE_URL}/api/auth/passkeys/login/opcoes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-aplicacao-id": appB.clientId },
    });
    expect(opcoes.status).toBe(200);
    const { passkeyToken } = await opcoes.json();

    const resposta = await fetch(`${BASE_URL}/api/auth/passkeys/login/confirmar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": ipAleatorio(),
        "x-aplicacao-id": appB.clientId,
      },
      body: JSON.stringify({ passkeyToken, resposta: { id: credentialId } }),
    });

    expect(resposta.status).toBe(401);
    // Mesma mensagem de credencial desconhecida: dizer "essa passkey é de
    // outro cliente" confirmaria a existência da conta lá.
    expect((await resposta.json()).erro).toBe("Passkey não reconhecida.");
  });
});

describe("JWKS", () => {
  it("publica as chaves de assinatura em /.well-known/jwks.json", async () => {
    const resposta = await fetch(`${BASE_URL}/.well-known/jwks.json`);
    expect(resposta.status).toBe(200);

    const jwks = await resposta.json();
    expect(Array.isArray(jwks.keys)).toBe(true);
    expect(jwks.keys.length).toBeGreaterThan(0);

    for (const chave of jwks.keys) {
      expect(chave.kty).toBe("RSA");
      expect(chave.alg).toBe("RS256");
      expect(chave.use).toBe("sig");
      expect(typeof chave.kid).toBe("string");
      // Só material público sai daqui: `d` é o expoente privado. Se ele
      // aparecer, a chave de assinatura vazou pra internet inteira.
      expect(chave.d).toBeUndefined();
    }
  });

  it("o access token traz um kid que existe no JWKS", async () => {
    const email = gerarEmailTeste("kid-no-jwks");
    emailsCriados.push(email);
    expect((await cadastrar(email)).status).toBe(201);

    const login = await logar(email);
    expect(login.status).toBe(200);

    const cookies = login.headers.getSetCookie().join("; ");
    const tokenAcesso = /tokenAcesso=([^;]+)/.exec(cookies)?.[1];
    expect(tokenAcesso).toBeTruthy();

    const header = JSON.parse(
      Buffer.from(tokenAcesso!.split(".")[0], "base64url").toString("utf8"),
    );
    expect(header.alg).toBe("RS256");
    expect(header.kid).toBeTruthy();

    const jwks = await (await fetch(`${BASE_URL}/.well-known/jwks.json`)).json();
    // É o contrato inteiro: um consumidor que não conhece nada além desta URL
    // consegue validar o token só pelo kid.
    expect(jwks.keys.map((chave: { kid: string }) => chave.kid)).toContain(header.kid);
  });

  it("o access token carrega aplicacaoId e aud batendo com ele", async () => {
    const app = await criarAplicacao("Cliente aud");
    const email = gerarEmailTeste("aud-aplicacao");
    emailsCriados.push(email);
    expect((await cadastrar(email, app.clientId)).status).toBe(201);

    const login = await logar(email, app.clientId);
    const cookies = login.headers.getSetCookie().join("; ");
    const tokenAcesso = /tokenAcesso=([^;]+)/.exec(cookies)?.[1];
    const payload = JSON.parse(
      Buffer.from(tokenAcesso!.split(".")[1], "base64url").toString("utf8"),
    );

    expect(payload.aplicacaoId).toBe(app.id);
    // `aud` é o que permite um consumidor de aplicação única recusar token de
    // outra sem consultar banco nenhum.
    expect(payload.aud).toBe(app.id);
  });
});
