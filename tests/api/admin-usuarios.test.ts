import * as OTPAuth from "otpauth";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/token";
import {
  apagarUsuariosTeste,
  BASE_URL,
  cabecalhoCookie,
  criarUsuarioTeste,
  extrairTodosCookies,
  loginTeste,
} from "../helpers";

const emailsCriados: string[] = [];

// Todo cadastro já cria uma organização pessoal e vira "dono" dela (ver
// src/lib/organizacao.ts) — é a organização que resolverOrganizacaoAtiva usa
// no login (primeira por criadoEm), então é sempre esta que a sessão de
// login normal do ator usa. Testes de RBAC de organização manipulam
// diretamente Membro (sem invite/troca de org, que são fase 5) pra montar o
// cenário: rebaixar o papel do próprio ator na PRÓPRIA organização, e
// adicionar o alvo como membro dessa mesma organização.
async function obterOrganizacaoDoUsuario(usuarioId: string) {
  const membro = await prisma.membro.findFirstOrThrow({
    where: { usuarioId },
    orderBy: { criadoEm: "asc" },
  });
  return membro.organizacaoId;
}

async function definirPapelNaPropriaOrganizacao(
  usuarioId: string,
  papel: "dono" | "admin" | "membro",
) {
  const organizacaoId = await obterOrganizacaoDoUsuario(usuarioId);
  await prisma.membro.update({
    where: { organizacaoId_usuarioId: { organizacaoId, usuarioId } },
    data: { papel },
  });
  return organizacaoId;
}

async function adicionarComoMembro(
  organizacaoId: string,
  usuarioId: string,
  papel: "dono" | "admin" | "membro" = "membro",
) {
  await prisma.membro.create({ data: { organizacaoId, usuarioId, papel } });
}

// Confere o status de uma renovação e, se vier outro, falha com o estado das
// sessões e dos vínculos da conta na mensagem — lido ANTES da limpeza do fim
// do teste, que apaga tudo. Em 2026-09-24 a renovação da sessão pessoal voltou
// 401 onde devia ser 200, uma vez em cinco rodadas da suíte, e não se
// reproduziu sob investigação; da próxima vez, a causa sai no próprio log.
async function conferirRenovacao(
  resposta: Response,
  esperado: number,
  usuarioId: string,
  cookies: Record<string, string>,
) {
  if (resposta.status === esperado) return;
  const apresentada = cookies.tokenAtualizacao ? hashToken(cookies.tokenAtualizacao) : null;
  const sessoes = await prisma.tokenAtualizacao.findMany({
    where: { usuarioId },
    orderBy: { criadoEm: "asc" },
    select: {
      tokenHash: true,
      organizacaoId: true,
      criadoEm: true,
      expiraEm: true,
      revogadoEm: true,
      revogadoMotivo: true,
    },
  });
  const diagnostico = {
    // Uma renovação que deu certo sem dever traz os tokens no corpo: fora do log.
    corpo: (await resposta.text()).replace(/("token[A-Za-z]*":")[^"]+"/g, '$1[omitido]"'),
    sessaoApresentada: apresentada?.slice(0, 12) ?? "sem cookie tokenAtualizacao",
    sessoes: sessoes.map(({ tokenHash, ...resto }) => ({
      tokenHash: tokenHash.slice(0, 12),
      apresentada: tokenHash === apresentada,
      ...resto,
    })),
    membros: await prisma.membro.findMany({
      where: { usuarioId },
      select: { organizacaoId: true, papel: true, suspenso: true, suspensoAte: true, criadoEm: true },
    }),
  };
  expect(resposta.status, JSON.stringify(diagnostico, null, 2)).toBe(esperado);
}

// Suspensão é por organização: com a organização pessoal intacta, o alvo
// suspenso na organização do dono continua logando (na pessoal). Pra testar
// o bloqueio TOTAL de login, o alvo precisa pertencer só à organização do
// dono — apaga a pessoal dele (Membro cai junto, em cascata).
async function deixarSomenteNaOrganizacao(organizacaoId: string, usuarioId: string) {
  const pessoal = await obterOrganizacaoDoUsuario(usuarioId);
  await prisma.organizacao.delete({ where: { id: pessoal } });
  await adicionarComoMembro(organizacaoId, usuarioId);
}

describe("Admin de organização — suspender/reativar/remover membro", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("membro comum recebe 403 ao tentar suspender outro membro da organização", async () => {
    const ator = await criarUsuarioTeste("membro-susp-403");
    const alvo = await criarUsuarioTeste("alvo-susp-403");
    emailsCriados.push(ator.email, alvo.email);
    const atorRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: ator.email } });
    const alvoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: alvo.email } });

    const organizacaoId = await definirPapelNaPropriaOrganizacao(atorRegistro.id, "membro");
    await adicionarComoMembro(organizacaoId, alvoRegistro.id);
    const { cabecalhos } = await loginTeste(ator.email, ator.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/usuarios/${alvoRegistro.id}/suspender`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({}),
    });
    expect(resposta.status).toBe(403);
  });

  it("dono suspende temporariamente e o login passa a ser bloqueado (única organização)", async () => {
    const dono = await criarUsuarioTeste("dono-susp-temp");
    const alvo = await criarUsuarioTeste("alvo-susp-temp");
    emailsCriados.push(dono.email, alvo.email);
    const donoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: dono.email } });
    const alvoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: alvo.email } });
    const organizacaoDoDono = await obterOrganizacaoDoUsuario(donoRegistro.id);
    await deixarSomenteNaOrganizacao(organizacaoDoDono, alvoRegistro.id);
    const { cabecalhos } = await loginTeste(dono.email, dono.senha);

    const respostaSuspender = await fetch(
      `${BASE_URL}/api/auth/usuarios/${alvoRegistro.id}/suspender`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecalhos },
        body: JSON.stringify({ dias: 7, motivo: "teste automatizado" }),
      },
    );
    expect(respostaSuspender.status).toBe(200);

    const respostaLogin = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: alvo.email, senha: alvo.senha }),
    });
    expect(respostaLogin.status).toBe(403);
    const corpoLogin = await respostaLogin.json();
    expect(corpoLogin.erro).toMatch(/suspensa/i);

    const respostaLista = await fetch(`${BASE_URL}/api/auth/usuarios`, { headers: cabecalhos });
    const corpoLista = await respostaLista.json();
    const linha = corpoLista.usuarios.find((u: { id: string }) => u.id === alvoRegistro.id);
    expect(linha.suspensoAtivo).toBe(true);
    expect(linha.suspensoMotivo).toBe("teste automatizado");
  });

  it("admin da organização (não dono) também suspende e reativa", async () => {
    const admin = await criarUsuarioTeste("admin-org-susp-perm");
    const alvo = await criarUsuarioTeste("alvo-org-susp-perm");
    emailsCriados.push(admin.email, alvo.email);
    const adminRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: admin.email } });
    const alvoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: alvo.email } });
    const organizacaoDoAdmin = await definirPapelNaPropriaOrganizacao(adminRegistro.id, "admin");
    await deixarSomenteNaOrganizacao(organizacaoDoAdmin, alvoRegistro.id);
    const { cabecalhos } = await loginTeste(admin.email, admin.senha);

    await fetch(`${BASE_URL}/api/auth/usuarios/${alvoRegistro.id}/suspender`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({}),
    });

    const loginBloqueado = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: alvo.email, senha: alvo.senha }),
    });
    expect(loginBloqueado.status).toBe(403);

    const respostaReativar = await fetch(
      `${BASE_URL}/api/auth/usuarios/${alvoRegistro.id}/reativar`,
      { method: "POST", headers: cabecalhos },
    );
    expect(respostaReativar.status).toBe(200);

    const loginLiberado = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: alvo.email, senha: alvo.senha }),
    });
    expect(loginLiberado.status).toBe(200);
  });

  it("suspender revoga na hora as sessões da organização, e só as dela", async () => {
    const dono = await criarUsuarioTeste("dono-susp-sessao");
    const alvo = await criarUsuarioTeste("alvo-susp-sessao");
    emailsCriados.push(dono.email, alvo.email);
    const donoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: dono.email } });
    const alvoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: alvo.email } });
    const organizacaoDoDono = await obterOrganizacaoDoUsuario(donoRegistro.id);
    await adicionarComoMembro(organizacaoDoDono, alvoRegistro.id);
    const { cabecalhos } = await loginTeste(dono.email, dono.senha);

    // Duas sessões do alvo: uma na organização pessoal (a do login) e outra
    // trocada pra organização do dono.
    const sessaoPessoal = await loginTeste(alvo.email, alvo.senha);
    const sessaoParaTrocar = await loginTeste(alvo.email, alvo.senha);
    const respostaEntrar = await fetch(
      `${BASE_URL}/api/auth/organizacoes/${organizacaoDoDono}/entrar`,
      { method: "POST", headers: sessaoParaTrocar.cabecalhos },
    );
    expect(respostaEntrar.status).toBe(200);
    const cookiesNaOrganizacaoDoDono = {
      ...sessaoParaTrocar.cookies,
      ...extrairTodosCookies(respostaEntrar),
    };

    await fetch(`${BASE_URL}/api/auth/usuarios/${alvoRegistro.id}/suspender`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ dias: 1 }),
    });

    const atualizarNaOrganizacaoDoDono = await fetch(`${BASE_URL}/api/auth/atualizar`, {
      method: "POST",
      headers: {
        Cookie: cabecalhoCookie(cookiesNaOrganizacaoDoDono),
        "X-CSRF-Token": cookiesNaOrganizacaoDoDono.csrfToken,
        // O IP simulado do login: sem ele, o servidor de teste vê ::1, e o
        // limite de falhas de renovação por IP é dividido com a suíte inteira.
        "X-Forwarded-For": sessaoParaTrocar.cabecalhos["X-Forwarded-For"],
      },
    });
    await conferirRenovacao(atualizarNaOrganizacaoDoDono, 401, alvoRegistro.id, cookiesNaOrganizacaoDoDono);

    const atualizarNaPessoal = await fetch(`${BASE_URL}/api/auth/atualizar`, {
      method: "POST",
      headers: sessaoPessoal.cabecalhos,
    });
    // Ordem importa: a renovação recusada acima reapresentou um token
    // revogado. Se isso fosse tratado como reuso de token roubado, teria
    // derrubado esta sessão também (e mandado alerta de invasão).
    await conferirRenovacao(atualizarNaPessoal, 200, alvoRegistro.id, sessaoPessoal.cookies);
    const alertaReuso = await prisma.logAuditoria.findFirst({
      where: { evento: "reuso_token_detectado", usuarioId: alvoRegistro.id },
    });
    expect(alertaReuso).toBeNull();
  });

  it("suspenso numa organização continua logando nas outras, mas não entra na suspensa", async () => {
    const dono = await criarUsuarioTeste("dono-susp-parcial");
    const alvo = await criarUsuarioTeste("alvo-susp-parcial");
    emailsCriados.push(dono.email, alvo.email);
    const donoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: dono.email } });
    const alvoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: alvo.email } });
    const organizacaoDoDono = await obterOrganizacaoDoUsuario(donoRegistro.id);
    const organizacaoPessoalDoAlvo = await obterOrganizacaoDoUsuario(alvoRegistro.id);
    await adicionarComoMembro(organizacaoDoDono, alvoRegistro.id);
    const { cabecalhos } = await loginTeste(dono.email, dono.senha);

    const respostaSuspender = await fetch(
      `${BASE_URL}/api/auth/usuarios/${alvoRegistro.id}/suspender`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecalhos },
        body: JSON.stringify({ motivo: "só nesta organização" }),
      },
    );
    expect(respostaSuspender.status).toBe(200);

    const sessaoAlvo = await loginTeste(alvo.email, alvo.senha);
    const sessaoCriada = await prisma.tokenAtualizacao.findFirstOrThrow({
      where: { usuarioId: alvoRegistro.id, revogadoEm: null },
      orderBy: { criadoEm: "desc" },
    });
    expect(sessaoCriada.organizacaoId).toBe(organizacaoPessoalDoAlvo);

    const respostaLista = await fetch(`${BASE_URL}/api/auth/organizacoes`, {
      headers: sessaoAlvo.cabecalhos,
    });
    const { organizacoes } = await respostaLista.json();
    const naDoDono = organizacoes.find((o: { id: string }) => o.id === organizacaoDoDono);
    expect(naDoDono.suspenso).toBe(true);
    // Motivo não vaza na listagem — só o /entrar conta, a quem tenta.
    expect(naDoDono.suspensoMotivo).toBeUndefined();

    const respostaEntrar = await fetch(
      `${BASE_URL}/api/auth/organizacoes/${organizacaoDoDono}/entrar`,
      { method: "POST", headers: sessaoAlvo.cabecalhos },
    );
    expect(respostaEntrar.status).toBe(403);
    expect((await respostaEntrar.json()).erro).toMatch(/só nesta organização/);
  });

  it("organização em que a pessoa entrou antes da pessoal é pulada no login quando suspensa", async () => {
    // resolverOrganizacaoAtiva pega a PRIMEIRA por criadoEm — se a suspensa é
    // a primeira, o login tem que abrir na seguinte, não recusar.
    const dono = await criarUsuarioTeste("dono-susp-ordem");
    const alvo = await criarUsuarioTeste("alvo-susp-ordem");
    emailsCriados.push(dono.email, alvo.email);
    const donoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: dono.email } });
    const alvoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: alvo.email } });
    const organizacaoDoDono = await obterOrganizacaoDoUsuario(donoRegistro.id);
    const organizacaoPessoalDoAlvo = await obterOrganizacaoDoUsuario(alvoRegistro.id);
    await prisma.membro.create({
      data: {
        organizacaoId: organizacaoDoDono,
        usuarioId: alvoRegistro.id,
        criadoEm: new Date("2000-01-01T00:00:00Z"),
        suspenso: true,
      },
    });

    const sessaoAlvo = await loginTeste(alvo.email, alvo.senha);
    const sessao = await prisma.tokenAtualizacao.findFirstOrThrow({
      where: { usuarioId: alvoRegistro.id, revogadoEm: null },
      orderBy: { criadoEm: "desc" },
    });
    expect(sessaoAlvo.resposta.status).toBe(200);
    expect(sessao.organizacaoId).toBe(organizacaoPessoalDoAlvo);
  });

  it("dono não consegue suspender nem remover a si mesmo", async () => {
    const dono = await criarUsuarioTeste("dono-auto-susp");
    emailsCriados.push(dono.email);
    const { cabecalhos } = await loginTeste(dono.email, dono.senha);
    const donoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: dono.email } });

    const respostaSuspender = await fetch(
      `${BASE_URL}/api/auth/usuarios/${donoRegistro.id}/suspender`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecalhos },
        body: JSON.stringify({}),
      },
    );
    expect(respostaSuspender.status).toBe(400);

    const respostaRemover = await fetch(`${BASE_URL}/api/auth/usuarios/${donoRegistro.id}`, {
      method: "DELETE",
      headers: cabecalhos,
    });
    expect(respostaRemover.status).toBe(400);
  });

  it("suspender no meio do desafio de MFA bloqueia a conclusão do login", async () => {
    const dono = await criarUsuarioTeste("dono-susp-mfa");
    const alvo = await criarUsuarioTeste("alvo-susp-mfa");
    emailsCriados.push(dono.email, alvo.email);
    const donoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: dono.email } });
    const alvoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: alvo.email } });
    const organizacaoDoDono = await obterOrganizacaoDoUsuario(donoRegistro.id);
    await deixarSomenteNaOrganizacao(organizacaoDoDono, alvoRegistro.id);
    const { cabecalhos: cabecalhosDono } = await loginTeste(dono.email, dono.senha);
    const { cabecalhos: cabecalhosAlvo } = await loginTeste(alvo.email, alvo.senha);

    // Ativa MFA no alvo.
    const respostaIniciar = await fetch(`${BASE_URL}/api/auth/mfa/iniciar`, {
      method: "POST",
      headers: cabecalhosAlvo,
    });
    const { segredo } = await respostaIniciar.json();
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(segredo),
    });
    await fetch(`${BASE_URL}/api/auth/mfa/confirmar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhosAlvo },
      body: JSON.stringify({ codigo: totp.generate() }),
    });

    // Login normal agora exige o desafio de MFA.
    const respostaLogin = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: alvo.email, senha: alvo.senha }),
    });
    const { mfaToken } = await respostaLogin.json();
    expect(mfaToken).toBeTruthy();

    // Dono suspende a conta ANTES do código de MFA ser enviado.
    await fetch(`${BASE_URL}/api/auth/usuarios/${alvoRegistro.id}/suspender`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhosDono },
      body: JSON.stringify({}),
    });

    // timestep diferente do usado na confirmação acima — senão colidiria com
    // a proteção contra replay de TOTP (mesmo código não pode validar duas
    // vezes), e o teste quer testar especificamente o bloqueio por
    // suspensão, não por replay.
    const respostaVerificar = await fetch(`${BASE_URL}/api/auth/mfa/verificar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mfaToken,
        codigo: totp.generate({ timestamp: Date.now() + 30_000 }),
      }),
    });
    expect(respostaVerificar.status).toBe(403);
  });

  it("registra o dono autor em suspensão/reativação, não só o alvo", async () => {
    const dono = await criarUsuarioTeste("dono-autor-log");
    const alvo = await criarUsuarioTeste("alvo-autor-log");
    emailsCriados.push(dono.email, alvo.email);
    const donoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: dono.email } });
    const alvoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: alvo.email } });
    const organizacaoDoDono = await obterOrganizacaoDoUsuario(donoRegistro.id);
    await adicionarComoMembro(organizacaoDoDono, alvoRegistro.id);
    const { cabecalhos } = await loginTeste(dono.email, dono.senha);

    await fetch(`${BASE_URL}/api/auth/usuarios/${alvoRegistro.id}/suspender`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({}),
    });
    await fetch(`${BASE_URL}/api/auth/usuarios/${alvoRegistro.id}/reativar`, {
      method: "POST",
      headers: cabecalhos,
    });

    const logSuspensao = await prisma.logAuditoria.findFirst({
      where: { evento: "usuario_suspenso_por_admin", usuarioId: alvoRegistro.id },
      orderBy: { criadoEm: "desc" },
    });
    expect(logSuspensao?.autorId).toBe(donoRegistro.id);
    expect(logSuspensao?.autorEmail).toBe(dono.email);

    const logReativacao = await prisma.logAuditoria.findFirst({
      where: { evento: "usuario_reativado_por_admin", usuarioId: alvoRegistro.id },
      orderBy: { criadoEm: "desc" },
    });
    expect(logReativacao?.autorId).toBe(donoRegistro.id);
    expect(logReativacao?.autorEmail).toBe(dono.email);
  });

  it("dono não consegue agir sobre alguém que não é membro da própria organização", async () => {
    const dono = await criarUsuarioTeste("dono-fora-org");
    const estranho = await criarUsuarioTeste("estranho-fora-org");
    emailsCriados.push(dono.email, estranho.email);
    const estranhoRegistro = await prisma.usuario.findFirstOrThrow({
      where: { email: estranho.email },
    });
    const { cabecalhos } = await loginTeste(dono.email, dono.senha);

    const resposta = await fetch(
      `${BASE_URL}/api/auth/usuarios/${estranhoRegistro.id}/suspender`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecalhos },
        body: JSON.stringify({}),
      },
    );
    expect(resposta.status).toBe(404);
  });

  it("dono remove membro da organização — conta continua existindo e ele segue logando na própria", async () => {
    const dono = await criarUsuarioTeste("dono-remover");
    const alvo = await criarUsuarioTeste("alvo-remover");
    emailsCriados.push(dono.email, alvo.email);
    const donoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: dono.email } });
    const alvoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: alvo.email } });
    const organizacaoDoDono = await obterOrganizacaoDoUsuario(donoRegistro.id);
    await adicionarComoMembro(organizacaoDoDono, alvoRegistro.id);
    const { cabecalhos } = await loginTeste(dono.email, dono.senha);

    // Sessão do alvo trocada pra organização do dono, antes da remoção.
    const sessaoPessoalAlvo = await loginTeste(alvo.email, alvo.senha);
    const sessaoParaTrocar = await loginTeste(alvo.email, alvo.senha);
    const respostaEntrar = await fetch(
      `${BASE_URL}/api/auth/organizacoes/${organizacaoDoDono}/entrar`,
      { method: "POST", headers: sessaoParaTrocar.cabecalhos },
    );
    const cookiesNaOrganizacaoDoDono = {
      ...sessaoParaTrocar.cookies,
      ...extrairTodosCookies(respostaEntrar),
    };

    const respostaRemover = await fetch(`${BASE_URL}/api/auth/usuarios/${alvoRegistro.id}`, {
      method: "DELETE",
      headers: cabecalhos,
    });
    expect(respostaRemover.status).toBe(200);

    // Renovar a sessão da organização de onde saiu é recusado, mas NÃO conta
    // como reuso de token roubado: a sessão pessoal sobrevive.
    const atualizarRemovida = await fetch(`${BASE_URL}/api/auth/atualizar`, {
      method: "POST",
      headers: {
        Cookie: cabecalhoCookie(cookiesNaOrganizacaoDoDono),
        "X-CSRF-Token": cookiesNaOrganizacaoDoDono.csrfToken,
        // Mesmo motivo do teste de suspensão: o IP simulado, não ::1.
        "X-Forwarded-For": sessaoParaTrocar.cabecalhos["X-Forwarded-For"],
      },
    });
    await conferirRenovacao(atualizarRemovida, 401, alvoRegistro.id, cookiesNaOrganizacaoDoDono);
    const atualizarPessoal = await fetch(`${BASE_URL}/api/auth/atualizar`, {
      method: "POST",
      headers: sessaoPessoalAlvo.cabecalhos,
    });
    await conferirRenovacao(atualizarPessoal, 200, alvoRegistro.id, sessaoPessoalAlvo.cookies);

    const membro = await prisma.membro.findUnique({
      where: {
        organizacaoId_usuarioId: { organizacaoId: organizacaoDoDono, usuarioId: alvoRegistro.id },
      },
    });
    expect(membro).toBeNull();

    // A conta em si NÃO foi excluída — só o vínculo com esta organização.
    const contaAlvo = await prisma.usuario.findUnique({ where: { id: alvoRegistro.id } });
    expect(contaAlvo).not.toBeNull();

    const logRemocao = await prisma.logAuditoria.findFirst({
      where: { evento: "membro_removido_da_organizacao", usuarioId: alvoRegistro.id },
      orderBy: { criadoEm: "desc" },
    });
    expect(logRemocao?.autorId).toBe(donoRegistro.id);

    // Alvo continua conseguindo logar — na PRÓPRIA organização pessoal, que
    // nunca foi afetada por ele ter sido removido da organização do dono.
    const loginAlvo = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: alvo.email, senha: alvo.senha }),
    });
    expect(loginAlvo.status).toBe(200);
  });

  it("não deixa remover o único dono da organização", async () => {
    // O ator precisa logar numa sessão escopada pra ESTA organização — como
    // fase 5 (troca de organização) ainda não existe, a única forma de
    // conseguir isso é a organização ser a PRÓPRIA (primeira por criadoEm,
    // que é o que resolverOrganizacaoAtiva usa no login). Por isso quem age
    // aqui é "admin" na PRÓPRIA organização (rebaixado de dono pra admin), e
    // quem é removido é OUTRO usuário adicionado como o único dono dela.
    const admin = await criarUsuarioTeste("admin-remover-dono");
    emailsCriados.push(admin.email);
    const adminRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: admin.email } });
    const organizacao = await definirPapelNaPropriaOrganizacao(adminRegistro.id, "admin");

    const dono = await criarUsuarioTeste("dono-unico");
    emailsCriados.push(dono.email);
    const donoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: dono.email } });
    await adicionarComoMembro(organizacao, donoRegistro.id, "dono");

    const { cabecalhos } = await loginTeste(admin.email, admin.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/usuarios/${donoRegistro.id}`, {
      method: "DELETE",
      headers: cabecalhos,
    });
    // 403, não 400: desde a hierarquia de papéis (podeAgirSobre), admin não
    // remove dono nenhum — barrado antes mesmo da checagem de único dono.
    expect(resposta.status).toBe(403);

    const membroDono = await prisma.membro.findUnique({
      where: {
        organizacaoId_usuarioId: { organizacaoId: organizacao, usuarioId: donoRegistro.id },
      },
    });
    expect(membroDono).not.toBeNull();
  });
});
