import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  apagarUsuariosTeste,
  BASE_URL,
  cabecalhosAplicacao,
  criarUsuarioTeste,
  gerarEmailTeste,
  ipAleatorio,
  loginTeste,
  SENHA_TESTE,
} from "../helpers";

// Webhooks de ponta a ponta: o provedor (servidor de teste) entrega num
// "sistema do cliente" falso rodando neste processo.

type Recebido = { cabecalhos: Record<string, string | string[] | undefined>; corpo: string };
let receptor: Server;
let urlReceptor: string;
let statusReceptor = 200;
let atrasoReceptorMs = 0;
const recebidos: Recebido[] = [];

beforeAll(async () => {
  receptor = createServer((req, res) => {
    let corpo = "";
    req.on("data", (pedaco) => (corpo += pedaco));
    req.on("end", () => {
      recebidos.push({ cabecalhos: req.headers, corpo });
      setTimeout(() => {
        res.writeHead(statusReceptor);
        res.end("ok");
      }, atrasoReceptorMs);
    });
  });
  await new Promise<void>((resolve) => receptor.listen(0, "127.0.0.1", resolve));
  urlReceptor = `http://127.0.0.1:${(receptor.address() as AddressInfo).port}/hook`;
});

const emailsCriados: string[] = [];
const aplicacoesCriadas: string[] = [];
afterAll(async () => {
  await new Promise((resolve) => receptor.close(resolve));
  await prisma.usuario.deleteMany({ where: { aplicacaoId: { in: aplicacoesCriadas } } });
  await prisma.organizacao.deleteMany({ where: { aplicacaoId: { in: aplicacoesCriadas } } });
  await prisma.aplicacao.deleteMany({ where: { id: { in: aplicacoesCriadas } } });
  await apagarUsuariosTeste(emailsCriados);
});

async function sessaoOperador() {
  const operador = await criarUsuarioTeste("operador-webhooks");
  emailsCriados.push(operador.email);
  await prisma.usuario.updateMany({ where: { email: operador.email }, data: { papel: "admin" } });
  return (await loginTeste(operador.email, operador.senha)).cabecalhos;
}

function chamar(caminho: string, cabecalhos: Record<string, string>, metodo = "GET", corpo?: unknown) {
  return fetch(`${BASE_URL}${caminho}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...cabecalhos },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}

async function novaAplicacaoComWebhook(cabecalhos: Record<string, string>, eventos = ["usuario.criado"]) {
  const criar = await chamar("/api/auth/aplicacoes", cabecalhos, "POST", { nome: "Cliente com webhook" });
  const { aplicacao, clientSecret } = await criar.json();
  aplicacoesCriadas.push(aplicacao.id);
  const resposta = await chamar(`/api/auth/aplicacoes/${aplicacao.id}/webhooks`, cabecalhos, "POST", {
    url: urlReceptor,
    eventos,
  });
  expect(resposta.status).toBe(201);
  const { webhook, segredo } = await resposta.json();
  return { aplicacao: { ...aplicacao, clientSecret }, webhook, segredo: segredo as string };
}

async function esperarRecebidos(quantos: number, tempoMs = 8000) {
  const ate = Date.now() + tempoMs;
  while (recebidos.length < quantos && Date.now() < ate) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function assinaturaConfere(recebido: Recebido, segredo: string): boolean {
  const cabecalho = String(recebido.cabecalhos["x-auth-gateway-assinatura"]);
  const [, t, v1] = /^t=(\d+),v1=([0-9a-f]+)$/.exec(cabecalho) ?? [];
  if (!t || !v1) return false;
  const esperado = createHmac("sha256", segredo).update(`${t}.${recebido.corpo}`).digest("hex");
  return timingSafeEqual(Buffer.from(esperado), Buffer.from(v1));
}

describe("Webhooks", () => {
  it("cadastro numa aplicação com webhook entrega usuario.criado assinado, só com id e e-mail", async () => {
    const operador = await sessaoOperador();
    const { aplicacao, segredo } = await novaAplicacaoComWebhook(operador);
    expect(segredo).toMatch(/^whsec_/);
    recebidos.length = 0;

    const email = gerarEmailTeste("webhook-criado");
    const cadastro = await fetch(`${BASE_URL}/api/auth/cadastro`, {
      method: "POST",
      headers: cabecalhosAplicacao(aplicacao),
      body: JSON.stringify({ nome: "Pessoa do webhook", email, senha: SENHA_TESTE }),
    });
    expect(cadastro.status).toBe(201);

    await esperarRecebidos(1);
    expect(recebidos).toHaveLength(1);
    const [recebido] = recebidos;
    expect(recebido.cabecalhos["x-auth-gateway-evento"]).toBe("usuario.criado");
    expect(assinaturaConfere(recebido, segredo)).toBe(true);
    expect(assinaturaConfere(recebido, "whsec_outro")).toBe(false);

    const corpo = JSON.parse(recebido.corpo);
    expect(corpo.id).toBe(recebido.cabecalhos["x-auth-gateway-entrega"]);
    expect(corpo.evento).toBe("usuario.criado");
    expect(corpo.dados.usuario.email).toBe(email);
    expect(Object.keys(corpo.dados.usuario).sort()).toEqual(["email", "id"]);
    expect(recebido.corpo).not.toContain("senha");
  });

  it("destino fora do ar: a entrega fica pra nova tentativa, com o status registrado", async () => {
    const operador = await sessaoOperador();
    const { aplicacao, webhook } = await novaAplicacaoComWebhook(operador);
    statusReceptor = 500;
    recebidos.length = 0;
    try {
      await fetch(`${BASE_URL}/api/auth/cadastro`, {
        method: "POST",
        headers: cabecalhosAplicacao(aplicacao),
        body: JSON.stringify({ nome: "Pessoa", email: gerarEmailTeste("webhook-falha"), senha: SENHA_TESTE }),
      });
      await esperarRecebidos(1);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const entrega = await prisma.entregaWebhook.findFirstOrThrow({ where: { webhookId: webhook.id } });
      expect(entrega.entregueEm).toBeNull();
      expect(entrega.tentativas).toBe(1);
      expect(entrega.ultimoStatus).toBe(500);
      expect(entrega.proximaTentativaEm.getTime()).toBeGreaterThan(Date.now());
    } finally {
      statusReceptor = 200;
    }
  });

  it("retentativa: job e fila em paralelo enviam a entrega uma vez só", async () => {
    const operador = await sessaoOperador();
    const { webhook } = await novaAplicacaoComWebhook(operador);
    // Entrega que já falhou uma vez e cujo horário de nova tentativa chegou.
    const entrega = await prisma.entregaWebhook.create({
      data: {
        webhookId: webhook.id,
        evento: "usuario.criado",
        payload: { evento: "usuario.criado", criadoEm: new Date().toISOString(), dados: {} },
        tentativas: 1,
        ultimoStatus: 500,
        proximaTentativaEm: new Date(Date.now() - 60_000),
      },
    });
    recebidos.length = 0;
    // Destino lento: as três chamadas se sobrepõem enquanto a primeira envia.
    atrasoReceptorMs = 1500;
    try {
      const segredo = { Authorization: `Bearer ${process.env.CRON_SECRET}` };
      const respostas = await Promise.all([
        fetch(`${BASE_URL}/api/cron/webhooks`, { method: "POST", headers: segredo }),
        fetch(`${BASE_URL}/api/cron/webhooks`, { method: "POST", headers: segredo }),
        fetch(`${BASE_URL}/api/cron/limpar-tokens`, { method: "POST", headers: segredo }),
      ]);
      expect(respostas.map((r) => r.status)).toEqual([200, 200, 200]);
    } finally {
      atrasoReceptorMs = 0;
    }

    const paraEsta = recebidos.filter((r) => r.cabecalhos["x-auth-gateway-entrega"] === entrega.id);
    expect(paraEsta).toHaveLength(1);
    const depois = await prisma.entregaWebhook.findUniqueOrThrow({ where: { id: entrega.id } });
    expect(depois.entregueEm).not.toBeNull();
    expect(depois.tentativas).toBe(2);
  });

  it("aplicação não aprovada não recebe eventos nem pode testar", async () => {
    const cliente = await criarUsuarioTeste("webhook-self-service");
    emailsCriados.push(cliente.email);
    await prisma.usuario.updateMany({ where: { email: cliente.email }, data: { emailVerificado: true } });
    const { cabecalhos } = await loginTeste(cliente.email, cliente.senha);
    const { aplicacao, webhook } = await novaAplicacaoComWebhook(cabecalhos);
    recebidos.length = 0;

    await fetch(`${BASE_URL}/api/auth/cadastro`, {
      method: "POST",
      headers: cabecalhosAplicacao(aplicacao),
      body: JSON.stringify({ nome: "Pessoa", email: gerarEmailTeste("webhook-nao-aprovada"), senha: SENHA_TESTE }),
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(recebidos).toHaveLength(0);
    expect(await prisma.entregaWebhook.count({ where: { webhookId: webhook.id } })).toBe(0);

    const teste = await chamar(`/api/auth/aplicacoes/${aplicacao.id}/webhooks/${webhook.id}/teste`, cabecalhos, "POST");
    expect(teste.status).toBe(403);
  });

  it("teste entrega na hora; rotação troca o segredo; outra organização recebe 404", async () => {
    const operador = await sessaoOperador();
    const { aplicacao, webhook, segredo } = await novaAplicacaoComWebhook(operador);
    recebidos.length = 0;

    const teste = await chamar(`/api/auth/aplicacoes/${aplicacao.id}/webhooks/${webhook.id}/teste`, operador, "POST");
    expect(await teste.json()).toMatchObject({ entregue: true, status: 200 });
    expect(assinaturaConfere(recebidos[0], segredo)).toBe(true);

    const rotacao = await chamar(`/api/auth/aplicacoes/${aplicacao.id}/webhooks/${webhook.id}/segredo`, operador, "POST");
    const { segredo: novo } = await rotacao.json();
    expect(novo).not.toBe(segredo);
    await chamar(`/api/auth/aplicacoes/${aplicacao.id}/webhooks/${webhook.id}/teste`, operador, "POST");
    expect(assinaturaConfere(recebidos[1], novo)).toBe(true);
    expect(assinaturaConfere(recebidos[1], segredo)).toBe(false);

    const outro = await criarUsuarioTeste("webhook-outra-org");
    emailsCriados.push(outro.email);
    await prisma.usuario.updateMany({ where: { email: outro.email }, data: { emailVerificado: true } });
    const { cabecalhos: deOutraOrg } = await loginTeste(outro.email, outro.senha);
    expect((await chamar(`/api/auth/aplicacoes/${aplicacao.id}/webhooks`, deOutraOrg)).status).toBe(404);
    expect((await chamar(`/api/auth/aplicacoes/${aplicacao.id}/webhooks/${webhook.id}`, deOutraOrg, "DELETE")).status).toBe(404);
  });

  it("gestão de organização emite os eventos de membro e de organização; excluir agenda só a organização no Django", async () => {
    const eventos = [
      "membro.papel_alterado",
      "membro.removido",
      "membro.saiu",
      "organizacao.renomeada",
      "organizacao.transferida",
      "organizacao.excluida",
    ];
    const operador = await sessaoOperador();
    const { aplicacao } = await novaAplicacaoComWebhook(operador, eventos);

    // Contas da aplicação cliente, com sessão por Bearer (sem cookie, sem CSRF).
    async function conta(prefixo: string) {
      const email = gerarEmailTeste(prefixo);
      const cadastro = await fetch(`${BASE_URL}/api/auth/cadastro`, {
        method: "POST",
        headers: cabecalhosAplicacao(aplicacao),
        body: JSON.stringify({ nome: prefixo, email, senha: SENHA_TESTE }),
      });
      expect(cadastro.status).toBe(201);
      const { id } = await prisma.usuario.findFirstOrThrow({ where: { email, aplicacaoId: aplicacao.id } });
      return { id, email };
    }
    async function bearer(email: string) {
      const login = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: cabecalhosAplicacao(aplicacao),
        body: JSON.stringify({ email, senha: SENHA_TESTE }),
      });
      expect(login.status).toBe(200);
      return (await login.json()).tokenAcesso as string;
    }
    function como(token: string, metodo: string, caminho: string, corpo?: unknown) {
      return chamar(caminho, { Authorization: `Bearer ${token}`, "X-Forwarded-For": ipAleatorio() }, metodo, corpo);
    }

    const dono = await conta("org-evento-dono");
    const alvo = await conta("org-evento-alvo");
    const removido = await conta("org-evento-removido");
    const { organizacaoId } = await prisma.membro.findFirstOrThrow({ where: { usuarioId: dono.id } });
    await prisma.membro.createMany({
      data: [
        { organizacaoId, usuarioId: alvo.id, papel: "membro" },
        { organizacaoId, usuarioId: removido.id, papel: "membro" },
      ],
    });
    recebidos.length = 0;

    let tokenDono = await bearer(dono.email);
    expect((await como(tokenDono, "PATCH", `/api/auth/usuarios/${alvo.id}`, { papel: "admin" })).status).toBe(200);
    expect((await como(tokenDono, "PATCH", `/api/auth/organizacoes/${organizacaoId}`, { nome: "Nome novo" })).status).toBe(200);
    expect((await como(tokenDono, "DELETE", `/api/auth/usuarios/${removido.id}`)).status).toBe(200);
    const transferir = await como(tokenDono, "POST", `/api/auth/organizacoes/${organizacaoId}/transferir`, {
      usuarioId: alvo.id,
      senha: SENHA_TESTE,
    });
    expect(transferir.status).toBe(200);

    // Ex-dono cria outra organização (a sessão passa pra ela) e sai desta.
    const criar = await como(tokenDono, "POST", "/api/auth/organizacoes", { nome: "Outra do ex-dono" });
    expect(criar.status).toBe(201);
    tokenDono = (await criar.json()).tokenAcesso;
    expect((await como(tokenDono, "POST", `/api/auth/organizacoes/${organizacaoId}/sair`)).status).toBe(200);

    // Novo dono exclui (tem a organização pessoal pra onde ir).
    const tokenAlvo = await bearer(alvo.email);
    const excluir = await como(tokenAlvo, "DELETE", `/api/auth/organizacoes/${organizacaoId}`, { senha: SENHA_TESTE });
    expect(excluir.status).toBe(200);

    await esperarRecebidos(eventos.length);
    const porEvento = new Map(recebidos.map((r) => [String(r.cabecalhos["x-auth-gateway-evento"]), JSON.parse(r.corpo).dados]));
    expect([...porEvento.keys()].sort()).toEqual([...eventos].sort());
    for (const dados of porEvento.values()) expect(dados.organizacaoId).toBe(organizacaoId);
    expect(porEvento.get("membro.papel_alterado")).toMatchObject({ papel: "admin", papelAnterior: "membro", usuario: { id: alvo.id } });
    expect(porEvento.get("membro.removido").usuario.id).toBe(removido.id);
    expect(porEvento.get("membro.saiu").usuario.id).toBe(dono.id);
    expect(porEvento.get("organizacao.renomeada").nome).toBe("Nome novo");
    expect(porEvento.get("organizacao.transferida")).toMatchObject({ usuario: { id: alvo.id }, donoAnterior: { id: dono.id } });

    // Só a organização vai pro Django — nunca os dados legados de quem excluiu.
    const pendentes = await prisma.exclusaoDominioPendente.findMany({
      where: { alvo: { in: [`organizacao:${organizacaoId}`, `usuario:${alvo.id}`] } },
    });
    expect(pendentes.map((p) => p.alvo)).toEqual([`organizacao:${organizacaoId}`]);
    await prisma.exclusaoDominioPendente.deleteMany({ where: { alvo: `organizacao:${organizacaoId}` } });
  });

  it("recusa webhook pro próprio provedor e eventos desconhecidos", async () => {
    const operador = await sessaoOperador();
    const { aplicacao } = await novaAplicacaoComWebhook(operador);
    const proprio = await chamar(`/api/auth/aplicacoes/${aplicacao.id}/webhooks`, operador, "POST", {
      url: `${BASE_URL}/api/qualquer`,
      eventos: ["usuario.criado"],
    });
    expect(proprio.status).toBe(400);
    const eventoInvalido = await chamar(`/api/auth/aplicacoes/${aplicacao.id}/webhooks`, operador, "POST", {
      url: urlReceptor,
      eventos: ["usuario.inventado"],
    });
    expect(eventoInvalido.status).toBe(400);
  });
});
