import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  apagarUsuariosTeste,
  BASE_URL,
  criarUsuarioTeste,
  gerarEmailTeste,
  ipAleatorio,
  loginTeste,
  SENHA_TESTE,
} from "../helpers";

// Fase 01 do provedor: gestão de aplicações pelo painel.

const emailsCriados: string[] = [];
const aplicacoesCriadas: string[] = [];

afterAll(async () => {
  await apagarUsuariosTeste(emailsCriados);
  await prisma.organizacao.deleteMany({ where: { aplicacaoId: { in: aplicacoesCriadas } } });
  await prisma.aplicacao.deleteMany({ where: { id: { in: aplicacoesCriadas } } });
});

// Operador = admin de sistema com conta na aplicação padrão (o cadastro sem
// header cai nela).
async function sessaoOperador() {
  const operador = await criarUsuarioTeste("operador-provedor");
  emailsCriados.push(operador.email);
  await prisma.usuario.updateMany({ where: { email: operador.email }, data: { papel: "admin" } });
  return loginTeste(operador.email, operador.senha);
}

function chamar(
  caminho: string,
  cabecalhos: Record<string, string>,
  metodo = "GET",
  corpo?: unknown,
) {
  return fetch(`${BASE_URL}${caminho}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...cabecalhos },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}

async function criarPeloPainel(cabecalhos: Record<string, string>, dados: Record<string, unknown>) {
  const resposta = await chamar("/api/auth/aplicacoes", cabecalhos, "POST", dados);
  const corpo = await resposta.json();
  if (corpo.aplicacao?.id) aplicacoesCriadas.push(corpo.aplicacao.id);
  return { resposta, corpo };
}

describe("Gestão de aplicações — autorização", () => {
  it("usuário comum (sem e-mail verificado) recebe 403", async () => {
    const usuario = await criarUsuarioTeste("gestao-app-comum");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    expect((await chamar("/api/auth/aplicacoes", cabecalhos)).status).toBe(403);
    const { resposta } = await criarPeloPainel(cabecalhos, { nome: "Não deveria" });
    expect(resposta.status).toBe(403);
  });

  it("admin de sistema de OUTRA aplicação recebe 403 — não enxerga os outros clientes", async () => {
    const { cabecalhos: operador } = await sessaoOperador();
    const { corpo } = await criarPeloPainel(operador, { nome: "Cliente com admin" });
    const clientId = corpo.aplicacao.clientId;

    const email = gerarEmailTeste("admin-de-cliente");
    emailsCriados.push(email);
    const ip = ipAleatorio();
    await fetch(`${BASE_URL}/api/auth/cadastro`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip, "x-aplicacao-id": clientId, "x-aplicacao-segredo": corpo.clientSecret },
      body: JSON.stringify({ nome: "Admin do cliente", email, senha: SENHA_TESTE }),
    });
    await prisma.usuario.updateMany({ where: { email }, data: { papel: "admin" } });
    const login = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip, "x-aplicacao-id": clientId, "x-aplicacao-segredo": corpo.clientSecret },
      body: JSON.stringify({ email, senha: SENHA_TESTE }),
    });
    expect(login.status).toBe(200);
    // Conta de aplicação cliente não ganha cookie do painel: autentica com o
    // token do corpo, como o backend do cliente faria.
    expect(login.headers.getSetCookie().join("; ")).not.toContain("tokenAcesso=");
    const { tokenAcesso } = await login.json();
    const cabecalhosAdminCliente = { Authorization: `Bearer ${tokenAcesso}` };

    expect((await chamar("/api/auth/aplicacoes", cabecalhosAdminCliente)).status).toBe(403);
    const me = await (await chamar("/api/auth/me", cabecalhosAdminCliente)).json();
    expect(me.usuario.operadorProvedor).toBe(false);
  });

  it("mutação sem CSRF é recusada", async () => {
    const { cabecalhos } = await sessaoOperador();
    const semCsrf = { Cookie: cabecalhos.Cookie };
    const { resposta } = await criarPeloPainel(semCsrf, { nome: "Sem CSRF" });
    expect(resposta.status).toBe(403);
  });
});

describe("Gestão de aplicações — self-service", () => {
  // Dono da organização pessoal, na aplicação padrão, com e-mail verificado.
  async function sessaoCliente(prefixo: string) {
    const conta = await criarUsuarioTeste(prefixo);
    emailsCriados.push(conta.email);
    await prisma.usuario.updateMany({ where: { email: conta.email }, data: { emailVerificado: true } });
    const login = await loginTeste(conta.email, conta.senha);
    const registro = await prisma.usuario.findFirstOrThrow({ where: { email: conta.email } });
    const membro = await prisma.membro.findFirstOrThrow({ where: { usuarioId: registro.id } });
    return { ...login, organizacaoId: membro.organizacaoId, usuarioId: registro.id };
  }

  it("conta sem e-mail verificado não gerencia aplicações", async () => {
    const conta = await criarUsuarioTeste("self-service-nao-verificado");
    emailsCriados.push(conta.email);
    const { cabecalhos } = await loginTeste(conta.email, conta.senha);

    const { resposta, corpo } = await criarPeloPainel(cabecalhos, { nome: "Sem verificar" });
    expect(resposta.status).toBe(403);
    expect(corpo.erro).toContain("Verifique seu e-mail");
    const me = await (await chamar("/api/auth/me", cabecalhos)).json();
    expect(me.usuario.podeGerirAplicacoes).toBe(false);
  });

  it("membro comum (nem dono nem admin) não gerencia aplicações", async () => {
    const conta = await criarUsuarioTeste("self-service-membro");
    emailsCriados.push(conta.email);
    const registro = await prisma.usuario.findFirstOrThrow({ where: { email: conta.email } });
    await prisma.usuario.update({ where: { id: registro.id }, data: { emailVerificado: true } });
    await prisma.membro.updateMany({ where: { usuarioId: registro.id }, data: { papel: "membro" } });
    const { cabecalhos } = await loginTeste(conta.email, conta.senha);

    expect((await chamar("/api/auth/aplicacoes", cabecalhos)).status).toBe(403);
  });

  it("dono verificado cria, lista e edita só as aplicações da própria organização", async () => {
    const cliente = await sessaoCliente("self-service-dono");
    const me = await (await chamar("/api/auth/me", cliente.cabecalhos)).json();
    expect(me.usuario.podeGerirAplicacoes).toBe(true);
    expect(me.usuario.operadorProvedor).toBe(false);

    const { resposta, corpo } = await criarPeloPainel(cliente.cabecalhos, {
      nome: "Loja do cliente",
      origens: ["https://loja.cliente-self.com"],
    });
    expect(resposta.status).toBe(201);
    expect(corpo.clientSecret).toMatch(/^sec_/);
    const linha = await prisma.aplicacao.findUniqueOrThrow({ where: { id: corpo.aplicacao.id } });
    expect(linha.organizacaoDonaId).toBe(cliente.organizacaoId);

    // Não enxerga a aplicação padrão nem a de outro cliente.
    const outro = await sessaoCliente("self-service-outro");
    const { corpo: daOutra } = await criarPeloPainel(outro.cabecalhos, { nome: "App do outro" });
    const lista = await (await chamar("/api/auth/aplicacoes", cliente.cabecalhos)).json();
    expect(lista.aplicacoes.map((a: { id: string }) => a.id)).toEqual([corpo.aplicacao.id]);

    // Aplicação de outra organização: 404 em editar e em rotacionar o segredo.
    expect((await chamar(`/api/auth/aplicacoes/${daOutra.aplicacao.id}`, cliente.cabecalhos, "PATCH", { nome: "Invadida" })).status).toBe(404);
    expect((await chamar(`/api/auth/aplicacoes/${daOutra.aplicacao.id}/segredo`, cliente.cabecalhos, "POST")).status).toBe(404);
    const padrao = await prisma.aplicacao.findFirstOrThrow({ where: { padrao: true } });
    expect((await chamar(`/api/auth/aplicacoes/${padrao.id}`, cliente.cabecalhos, "PATCH", { ativa: false })).status).toBe(404);

    // A própria: edita e rotaciona.
    expect((await chamar(`/api/auth/aplicacoes/${corpo.aplicacao.id}`, cliente.cabecalhos, "PATCH", { nome: "Loja renomeada" })).status).toBe(200);
    expect((await chamar(`/api/auth/aplicacoes/${corpo.aplicacao.id}/segredo`, cliente.cabecalhos, "POST")).status).toBe(200);

    // O operador continua vendo as duas.
    const { cabecalhos: operador } = await sessaoOperador();
    const doOperador = await (await chamar("/api/auth/aplicacoes", operador)).json();
    const idsOperador = doOperador.aplicacoes.map((a: { id: string }) => a.id);
    expect(idsOperador).toContain(corpo.aplicacao.id);
    expect(idsOperador).toContain(daOutra.aplicacao.id);
  });

  it("self-service não define remetente próprio", async () => {
    const cliente = await sessaoCliente("self-service-remetente");
    const { resposta } = await criarPeloPainel(cliente.cabecalhos, {
      nome: "Com remetente",
      emailRemetente: "seguranca@provedor.com",
    });
    expect(resposta.status).toBe(400);

    const { corpo } = await criarPeloPainel(cliente.cabecalhos, { nome: "Sem remetente" });
    const editar = await chamar(`/api/auth/aplicacoes/${corpo.aplicacao.id}`, cliente.cabecalhos, "PATCH", {
      emailRemetente: "seguranca@provedor.com",
    });
    expect(editar.status).toBe(400);
  });

  it("limite de aplicações por conta: abrir outra organização não dá mais cota", async () => {
    const cliente = await sessaoCliente("self-service-limite");
    for (let i = 1; i <= 3; i++) {
      expect((await criarPeloPainel(cliente.cabecalhos, { nome: `App ${i}` })).resposta.status).toBe(201);
    }
    const { resposta, corpo } = await criarPeloPainel(cliente.cabecalhos, { nome: "App 4" });
    expect(resposta.status).toBe(403);
    expect(corpo.erro).toContain("limite");

    // Nova organização, entrando nela: o teto é da conta, não da organização.
    const novaOrg = await chamar("/api/auth/organizacoes", cliente.cabecalhos, "POST", { nome: "Outra empresa" });
    expect(novaOrg.status).toBe(201);
    const { organizacao } = await novaOrg.json();
    const entrar = await chamar(`/api/auth/organizacoes/${organizacao.id}/entrar`, cliente.cabecalhos, "POST");
    expect(entrar.status).toBe(200);
    const cookies = Object.fromEntries(
      entrar.headers.getSetCookie().map((linha) => {
        const [par] = linha.split(";");
        const [nome, valor] = par.split("=");
        return [nome, decodeURIComponent(valor)];
      }),
    );
    const naOutraOrg = {
      Cookie: `tokenAcesso=${cookies.tokenAcesso}; tokenAtualizacao=${cookies.tokenAtualizacao}; csrfToken=${cookies.csrfToken}`,
      "X-CSRF-Token": cookies.csrfToken,
    };
    expect((await criarPeloPainel(naOutraOrg, { nome: "App na outra" })).resposta.status).toBe(403);
  });

  it("self-service nasce aguardando aprovação; só o operador aprova", async () => {
    const cliente = await sessaoCliente("self-service-aprovacao");
    const { corpo } = await criarPeloPainel(cliente.cabecalhos, { nome: "Precisa aprovar" });
    expect(corpo.aplicacao.aprovada).toBe(false);

    const autoAprovar = await chamar(`/api/auth/aplicacoes/${corpo.aplicacao.id}`, cliente.cabecalhos, "PATCH", { aprovada: true });
    expect(autoAprovar.status).toBe(403);

    const { cabecalhos: operador } = await sessaoOperador();
    const aprovar = await chamar(`/api/auth/aplicacoes/${corpo.aplicacao.id}`, operador, "PATCH", { aprovada: true });
    expect(aprovar.status).toBe(200);
    expect((await aprovar.json()).aplicacao.aprovada).toBe(true);

    // Criada pelo operador já nasce aprovada.
    const { corpo: doOperador } = await criarPeloPainel(operador, { nome: "Do operador" });
    expect(doOperador.aplicacao.aprovada).toBe(true);
  });

  it("desativada pelo operador, o cliente não reativa; desativada por ele mesmo, reativa", async () => {
    const cliente = await sessaoCliente("self-service-reativar");
    const { corpo } = await criarPeloPainel(cliente.cabecalhos, { nome: "Vai ser desativada" });
    const id = corpo.aplicacao.id;

    expect((await chamar(`/api/auth/aplicacoes/${id}`, cliente.cabecalhos, "PATCH", { ativa: false })).status).toBe(200);
    expect((await chamar(`/api/auth/aplicacoes/${id}`, cliente.cabecalhos, "PATCH", { ativa: true })).status).toBe(200);

    const { cabecalhos: operador } = await sessaoOperador();
    expect((await chamar(`/api/auth/aplicacoes/${id}`, operador, "PATCH", { ativa: false })).status).toBe(200);
    const religar = await chamar(`/api/auth/aplicacoes/${id}`, cliente.cabecalhos, "PATCH", { ativa: true });
    expect(religar.status).toBe(403);

    expect((await chamar(`/api/auth/aplicacoes/${id}`, operador, "PATCH", { ativa: true })).status).toBe(200);
    const linha = await prisma.aplicacao.findUniqueOrThrow({ where: { id } });
    expect(linha.desativadaPeloOperador).toBe(false);
  });

  it("aplicação cliente não usa o domínio do provedor como origem nem RP ID", async () => {
    const cliente = await sessaoCliente("self-service-dominio-provedor");
    const comOrigemDoProvedor = await criarPeloPainel(cliente.cabecalhos, {
      nome: "Finge ser o painel",
      origens: [BASE_URL],
    });
    expect(comOrigemDoProvedor.resposta.status).toBe(400);
    expect(comOrigemDoProvedor.corpo.erro).toContain("domínio do próprio provedor");

    const comRpIdDoProvedor = await criarPeloPainel(cliente.cabecalhos, {
      nome: "RP ID do provedor",
      origens: ["https://app.cliente-rpid.com"],
      passkeyRpId: new URL(BASE_URL).hostname,
    });
    expect(comRpIdDoProvedor.resposta.status).toBe(400);
    expect(comRpIdDoProvedor.corpo.erro).toContain("domínio do próprio provedor");
  });
});

describe("Gestão de aplicações — ciclo de vida", () => {
  it("cria aplicação: segredo aparece uma vez e só o hash é gravado", async () => {
    const { cabecalhos } = await sessaoOperador();
    const me = await (await chamar("/api/auth/me", cabecalhos)).json();
    expect(me.usuario.operadorProvedor).toBe(true);

    const { resposta, corpo } = await criarPeloPainel(cabecalhos, {
      nome: "Cliente Acme",
      origens: ["https://app.acme.com", "https://www.acme.com", "https://app.acme.com"],
      passkeyRpId: "acme.com",
    });

    expect(resposta.status).toBe(201);
    expect(corpo.clientSecret).toMatch(/^sec_/);
    expect(corpo.aplicacao.clientId).toMatch(/^app_/);
    expect(corpo.aplicacao.origens).toEqual(["https://app.acme.com", "https://www.acme.com"]);
    expect(corpo.aplicacao.temSegredo).toBe(true);
    expect(corpo.aplicacao.clientSecretHash).toBeUndefined();

    const linha = await prisma.aplicacao.findUniqueOrThrow({ where: { id: corpo.aplicacao.id } });
    expect(linha.clientSecretHash).toBe(
      createHash("sha256").update(corpo.clientSecret).digest("hex"),
    );
    expect(linha.padrao).toBe(false);

    const lista = await (await chamar("/api/auth/aplicacoes", cabecalhos)).json();
    const listada = lista.aplicacoes.find((a: { id: string }) => a.id === corpo.aplicacao.id);
    expect(listada.nome).toBe("Cliente Acme");
    expect(JSON.stringify(lista)).not.toContain(linha.clientSecretHash);
  });

  it("recusa origem com caminho, http fora de localhost e RP ID que não cobre as origens", async () => {
    const { cabecalhos } = await sessaoOperador();

    // Nome válido em todos os casos: cada 400 aqui tem que vir da origem ou
    // do RP ID, não de um nome curto demais mascarando o motivo.
    const comCaminho = await criarPeloPainel(cabecalhos, {
      nome: "Origem com caminho",
      origens: ["https://acme.com/app"],
    });
    expect(comCaminho.resposta.status).toBe(400);
    expect(comCaminho.corpo.erro).toMatch(/Origem inválida/);

    const http = await criarPeloPainel(cabecalhos, {
      nome: "Origem http",
      origens: ["http://acme.com"],
    });
    expect(http.resposta.status).toBe(400);
    expect(http.corpo.erro).toMatch(/Origem inválida/);

    const localhost = await criarPeloPainel(cabecalhos, {
      nome: "Dev local",
      origens: ["http://localhost:5173"],
    });
    expect(localhost.resposta.status).toBe(201);

    const rpIdErrado = await criarPeloPainel(cabecalhos, {
      nome: "RP ID que não cobre",
      origens: ["https://app.acme.com.br"],
      passkeyRpId: "acme.com",
    });
    expect(rpIdErrado.resposta.status).toBe(400);
    expect(rpIdErrado.corpo.erro).toContain("https://app.acme.com.br");
  });

  it("guarda a marca dos e-mails e recusa endereço de links inválido", async () => {
    const { cabecalhos } = await sessaoOperador();

    const invalido = await criarPeloPainel(cabecalhos, {
      nome: "Links http",
      urlLinks: "http://cliente.com",
    });
    expect(invalido.resposta.status).toBe(400);

    const { resposta, corpo } = await criarPeloPainel(cabecalhos, {
      nome: "Cliente com marca",
      emailRemetente: "Seguranca@Cliente-Marca.com",
      urlLinks: "https://app.cliente-marca.com/",
      logoUrl: "https://cliente-marca.com/logo.png",
    });
    expect(resposta.status).toBe(201);
    expect(corpo.aplicacao.emailRemetente).toBe("seguranca@cliente-marca.com");
    // Barra final removida: os links são montados como `${urlLinks}/rota`.
    expect(corpo.aplicacao.urlLinks).toBe("https://app.cliente-marca.com");

    // Campo vazio no formulário limpa o valor.
    const limpar = await chamar(`/api/auth/aplicacoes/${corpo.aplicacao.id}`, cabecalhos, "PATCH", {
      logoUrl: "",
    });
    expect(limpar.status).toBe(200);
    expect((await limpar.json()).aplicacao.logoUrl).toBeNull();
  });

  it("não deixa desativar a aplicação padrão", async () => {
    const { cabecalhos } = await sessaoOperador();
    const padrao = await prisma.aplicacao.findFirstOrThrow({ where: { padrao: true } });

    const resposta = await chamar(`/api/auth/aplicacoes/${padrao.id}`, cabecalhos, "PATCH", {
      ativa: false,
    });
    expect(resposta.status).toBe(400);
    expect((await prisma.aplicacao.findUniqueOrThrow({ where: { id: padrao.id } })).ativa).toBe(true);
  });

  it("origens cadastradas na aplicação padrão não barram o login no próprio painel", async () => {
    // Incidente de produção (2026-09-16): a aplicação padrão ganhou uma lista
    // de origens sem o domínio do próprio site, e todo login pelo painel
    // passou a responder 403 "Origem não autorizada".
    const conta = await criarUsuarioTeste("origem-painel");
    emailsCriados.push(conta.email);
    const padrao = await prisma.aplicacao.findFirstOrThrow({ where: { padrao: true } });

    async function entrarCom(origem: string) {
      return fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": ipAleatorio(), Origin: origem },
        body: JSON.stringify({ email: conta.email, senha: SENHA_TESTE }),
      });
    }

    await prisma.aplicacao.update({
      where: { id: padrao.id },
      data: { origens: ["https://outro-site.exemplo"] },
    });
    try {
      expect((await entrarCom(BASE_URL)).status).toBe(200);
      expect((await entrarCom("https://outro-site.exemplo")).status).toBe(200);
      expect((await entrarCom("https://site-alheio.exemplo")).status).toBe(403);
    } finally {
      await prisma.aplicacao.update({ where: { id: padrao.id }, data: { origens: padrao.origens } });
    }
  });

  it("desativar corta login e sessões dos usuários dela, sem alarme falso de reuso de token", async () => {
    const { cabecalhos } = await sessaoOperador();
    const { corpo } = await criarPeloPainel(cabecalhos, { nome: "Cliente a desativar" });
    const { id, clientId } = corpo.aplicacao;

    const email = gerarEmailTeste("usuario-app-desativada");
    emailsCriados.push(email);
    const ip = ipAleatorio();
    const comApp = { "Content-Type": "application/json", "X-Forwarded-For": ip, "x-aplicacao-id": clientId, "x-aplicacao-segredo": corpo.clientSecret };
    await fetch(`${BASE_URL}/api/auth/cadastro`, {
      method: "POST",
      headers: comApp,
      body: JSON.stringify({ nome: "Usuário final", email, senha: SENHA_TESTE }),
    });
    const login = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: comApp,
      body: JSON.stringify({ email, senha: SENHA_TESTE }),
    });
    expect(login.status).toBe(200);
    const { tokenAtualizacao } = await login.json();

    const desativar = await chamar(`/api/auth/aplicacoes/${id}`, cabecalhos, "PATCH", { ativa: false });
    expect(desativar.status).toBe(200);

    const loginDepois = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: comApp,
      body: JSON.stringify({ email, senha: SENHA_TESTE }),
    });
    expect(loginDepois.status).toBe(400);

    // Renovação pelo corpo (fluxo de app sem cookie): sem cookie nenhum, a
    // checagem CSRF não se aplica.
    const renovar = await fetch(`${BASE_URL}/api/auth/atualizar`, {
      method: "POST",
      headers: comApp,
      body: JSON.stringify({ tokenAtualizacao }),
    });
    expect(renovar.status).toBe(401);

    const usuario = await prisma.usuario.findFirstOrThrow({ where: { email } });
    const alarme = await prisma.logAuditoria.findFirst({
      where: { evento: "reuso_token_detectado", usuarioId: usuario.id },
    });
    expect(alarme).toBeNull();
    const sessoesVivas = await prisma.tokenAtualizacao.count({
      where: { usuarioId: usuario.id, revogadoEm: null },
    });
    expect(sessoesVivas).toBe(0);

    const log = await prisma.logAuditoria.findFirst({
      where: { evento: "aplicacao_desativada" },
      orderBy: { criadoEm: "desc" },
    });
    expect(log?.autorEmail).toBeTruthy();
  });

  it("desativar durante o desafio de MFA impede a conclusão do login", async () => {
    const { cabecalhos } = await sessaoOperador();
    const { corpo } = await criarPeloPainel(cabecalhos, { nome: "Cliente com MFA" });
    const { id, clientId } = corpo.aplicacao;

    const email = gerarEmailTeste("usuario-mfa-app-desativada");
    emailsCriados.push(email);
    const comApp = { "Content-Type": "application/json", "X-Forwarded-For": ipAleatorio(), "x-aplicacao-id": clientId, "x-aplicacao-segredo": corpo.clientSecret };
    await fetch(`${BASE_URL}/api/auth/cadastro`, {
      method: "POST",
      headers: comApp,
      body: JSON.stringify({ nome: "Usuário final", email, senha: SENHA_TESTE }),
    });
    const usuario = await prisma.usuario.findFirstOrThrow({ where: { email, aplicacaoId: id } });
    // MFA ativo direto no banco: o que se testa é a conclusão do desafio,
    // não o fluxo de ativação (coberto em mfa.test.ts).
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { mfaAtivado: true, mfaSecret: "segredo-irrelevante-para-este-teste" },
    });

    const login = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: comApp,
      body: JSON.stringify({ email, senha: SENHA_TESTE }),
    });
    const { mfaToken } = await login.json();
    expect(mfaToken).toBeTruthy();

    await chamar(`/api/auth/aplicacoes/${id}`, cabecalhos, "PATCH", { ativa: false });

    const verificar = await fetch(`${BASE_URL}/api/auth/mfa/verificar`, {
      method: "POST",
      headers: comApp,
      body: JSON.stringify({ mfaToken, codigo: "123456" }),
    });
    expect(verificar.status).toBe(400);
    const backup = await fetch(`${BASE_URL}/api/auth/mfa/backup`, {
      method: "POST",
      headers: comApp,
      body: JSON.stringify({ mfaToken, codigo: "ABCDE-FGHJK" }),
    });
    expect(backup.status).toBe(400);
  });

  it("rotacionar o segredo troca o hash e devolve o novo uma vez", async () => {
    const { cabecalhos } = await sessaoOperador();
    const { corpo } = await criarPeloPainel(cabecalhos, { nome: "Cliente rotação" });
    const antes = await prisma.aplicacao.findUniqueOrThrow({ where: { id: corpo.aplicacao.id } });

    const resposta = await chamar(`/api/auth/aplicacoes/${corpo.aplicacao.id}/segredo`, cabecalhos, "POST");
    expect(resposta.status).toBe(200);
    const { clientSecret } = await resposta.json();

    const depois = await prisma.aplicacao.findUniqueOrThrow({ where: { id: corpo.aplicacao.id } });
    expect(depois.clientSecretHash).not.toBe(antes.clientSecretHash);
    expect(depois.clientSecretHash).toBe(createHash("sha256").update(clientSecret).digest("hex"));
    expect(clientSecret).not.toBe(corpo.clientSecret);
  });

  it("a auditoria registra QUAL aplicação foi criada, editada e teve o segredo trocado", async () => {
    const { cabecalhos } = await sessaoOperador();
    const { corpo } = await criarPeloPainel(cabecalhos, { nome: "Cliente auditado" });
    const { id, clientId } = corpo.aplicacao;
    await chamar(`/api/auth/aplicacoes/${id}`, cabecalhos, "PATCH", { nome: "Cliente auditado 2" });
    await chamar(`/api/auth/aplicacoes/${id}/segredo`, cabecalhos, "POST");

    const eventos = await prisma.logAuditoria.findMany({
      where: { alvo: { startsWith: `aplicacao:${clientId}` } },
      orderBy: { criadoEm: "asc" },
      select: { evento: true, alvo: true, autorEmail: true },
    });
    expect(eventos.map((e) => e.evento)).toEqual([
      "aplicacao_criada",
      "aplicacao_atualizada",
      "segredo_aplicacao_rotacionado",
    ]);
    expect(eventos[0].alvo).toBe(`aplicacao:${clientId} (Cliente auditado)`);
    expect(eventos[1].alvo).toBe(`aplicacao:${clientId} (Cliente auditado 2)`);

    const painel = await (await chamar("/api/auth/auditoria?evento=aplicacao_criada", cabecalhos)).json();
    expect(painel.registros.some((r: { alvo: string | null }) => r.alvo?.startsWith(`aplicacao:${clientId}`))).toBe(true);
  });

  it("recusa trocar o RP ID quando já existem passkeys registradas", async () => {
    const { cabecalhos } = await sessaoOperador();
    const { corpo } = await criarPeloPainel(cabecalhos, {
      nome: "Cliente com passkeys",
      origens: ["https://app.cliente-passkey.com"],
      passkeyRpId: "cliente-passkey.com",
    });
    const { id, clientId } = corpo.aplicacao;

    const email = gerarEmailTeste("usuario-passkey-rpid");
    emailsCriados.push(email);
    await fetch(`${BASE_URL}/api/auth/cadastro`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ipAleatorio(), "x-aplicacao-id": clientId, "x-aplicacao-segredo": corpo.clientSecret },
      body: JSON.stringify({ nome: "Usuário final", email, senha: SENHA_TESTE }),
    });
    const usuario = await prisma.usuario.findFirstOrThrow({ where: { email, aplicacaoId: id } });
    await prisma.passkeyCredencial.create({
      data: {
        usuarioId: usuario.id,
        credentialId: `cred-${Math.random().toString(36).slice(2)}`,
        publicKey: "chave-de-teste",
      },
    });

    const trocarRpId = await chamar(`/api/auth/aplicacoes/${id}`, cabecalhos, "PATCH", {
      origens: ["https://outro-dominio.com"],
      passkeyRpId: "outro-dominio.com",
    });
    expect(trocarRpId.status).toBe(409);

    // Mudar só o nome continua livre.
    const renomear = await chamar(`/api/auth/aplicacoes/${id}`, cabecalhos, "PATCH", {
      nome: "Cliente renomeado",
    });
    expect(renomear.status).toBe(200);
    expect((await renomear.json()).aplicacao.nome).toBe("Cliente renomeado");
  });
});
