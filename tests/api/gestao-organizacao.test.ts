import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  apagarAplicacoesTeste,
  apagarUsuariosTeste,
  BASE_URL,
  cabecalhoCookie,
  criarAplicacaoTeste,
  criarUsuarioTeste,
  extrairTodosCookies,
  loginTeste,
  SENHA_TESTE,
} from "../helpers";

const emailsCriados: string[] = [];

type PapelOrganizacao = "dono" | "admin" | "membro";

// Conta nova já logada. A sessão do login cai na organização pessoal (a
// primeira por criadoEm), da qual ela é dona.
async function contaLogada(prefixo: string) {
  const conta = await criarUsuarioTeste(prefixo);
  emailsCriados.push(conta.email);
  const usuario = await prisma.usuario.findFirstOrThrow({ where: { email: conta.email } });
  const { organizacaoId: pessoalId } = await prisma.membro.findFirstOrThrow({
    where: { usuarioId: usuario.id },
    orderBy: { criadoEm: "asc" },
  });
  const { cabecalhos } = await loginTeste(conta.email, conta.senha);
  return { id: usuario.id, email: conta.email, pessoalId, cabecalhos };
}

async function adicionarComoMembro(organizacaoId: string, usuarioId: string, papel: PapelOrganizacao) {
  await prisma.membro.create({ data: { organizacaoId, usuarioId, papel } });
}

// Troca a sessão pra outra organização e devolve os cabeçalhos com os cookies
// novos — o papel no access token passa a ser o dessa organização.
async function entrarEm(cabecalhos: Record<string, string>, organizacaoId: string) {
  const resposta = await fetch(`${BASE_URL}/api/auth/organizacoes/${organizacaoId}/entrar`, {
    method: "POST",
    headers: cabecalhos,
  });
  expect(resposta.status).toBe(200);
  return cabecalhosDaResposta(cabecalhos, resposta);
}

function cabecalhosDaResposta(anteriores: Record<string, string>, resposta: Response) {
  const cookies = extrairTodosCookies(resposta);
  return {
    ...anteriores,
    Cookie: cabecalhoCookie(cookies),
    "X-CSRF-Token": cookies.csrfToken,
  };
}

function enviar(
  metodo: string,
  caminho: string,
  cabecalhos: Record<string, string>,
  corpo?: unknown,
) {
  return fetch(`${BASE_URL}${caminho}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...cabecalhos },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}

async function papelNoBanco(organizacaoId: string, usuarioId: string) {
  const membro = await prisma.membro.findUnique({
    where: { organizacaoId_usuarioId: { organizacaoId, usuarioId } },
  });
  return membro?.papel ?? null;
}

async function organizacaoAtiva(cabecalhos: Record<string, string>) {
  const resposta = await fetch(`${BASE_URL}/api/auth/me`, { headers: cabecalhos });
  expect(resposta.status).toBe(200);
  return (await resposta.json()).usuario.organizacaoId as string;
}

describe("Gestão de organização — papel dos membros", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("dono promove membro a admin e rebaixa de volta, com auditoria", async () => {
    const dono = await contaLogada("papel-dono");
    const alvo = await contaLogada("papel-alvo");
    await adicionarComoMembro(dono.pessoalId, alvo.id, "membro");

    const promover = await enviar("PATCH", `/api/auth/usuarios/${alvo.id}`, dono.cabecalhos, {
      papel: "admin",
    });
    expect(promover.status).toBe(200);
    expect(await papelNoBanco(dono.pessoalId, alvo.id)).toBe("admin");

    const rebaixar = await enviar("PATCH", `/api/auth/usuarios/${alvo.id}`, dono.cabecalhos, {
      papel: "membro",
    });
    expect(rebaixar.status).toBe(200);
    expect(await papelNoBanco(dono.pessoalId, alvo.id)).toBe("membro");

    const eventos = await prisma.logAuditoria.count({
      where: { evento: "papel_organizacao_alterado", usuarioId: alvo.id, autorId: dono.id },
    });
    expect(eventos).toBe(2);
  });

  it("membro comum recebe 403 ao tentar mudar papel", async () => {
    const dono = await contaLogada("papel-403-dono");
    const membro = await contaLogada("papel-403-membro");
    const alvo = await contaLogada("papel-403-alvo");
    await adicionarComoMembro(dono.pessoalId, membro.id, "membro");
    await adicionarComoMembro(dono.pessoalId, alvo.id, "membro");
    const cabecalhos = await entrarEm(membro.cabecalhos, dono.pessoalId);

    const resposta = await enviar("PATCH", `/api/auth/usuarios/${alvo.id}`, cabecalhos, {
      papel: "admin",
    });
    expect(resposta.status).toBe(403);
    expect(await papelNoBanco(dono.pessoalId, alvo.id)).toBe("membro");
  });

  it("não aceita promover a dono por aqui nem mudar o próprio papel", async () => {
    const dono = await contaLogada("papel-invalido-dono");
    const alvo = await contaLogada("papel-invalido-alvo");
    await adicionarComoMembro(dono.pessoalId, alvo.id, "membro");

    const virarDono = await enviar("PATCH", `/api/auth/usuarios/${alvo.id}`, dono.cabecalhos, {
      papel: "dono",
    });
    expect(virarDono.status).toBe(400);

    const proprio = await enviar("PATCH", `/api/auth/usuarios/${dono.id}`, dono.cabecalhos, {
      papel: "membro",
    });
    expect(proprio.status).toBe(400);
    expect(await papelNoBanco(dono.pessoalId, dono.id)).toBe("dono");
  });

  it("admin não rebaixa, suspende nem remove um dono", async () => {
    const dono = await contaLogada("hierarquia-dono");
    const admin = await contaLogada("hierarquia-admin");
    const outroDono = await contaLogada("hierarquia-outro-dono");
    await adicionarComoMembro(dono.pessoalId, admin.id, "admin");
    await adicionarComoMembro(dono.pessoalId, outroDono.id, "dono");
    const cabecalhos = await entrarEm(admin.cabecalhos, dono.pessoalId);

    const rebaixar = await enviar("PATCH", `/api/auth/usuarios/${outroDono.id}`, cabecalhos, {
      papel: "membro",
    });
    expect(rebaixar.status).toBe(403);

    const suspender = await enviar(
      "POST",
      `/api/auth/usuarios/${outroDono.id}/suspender`,
      cabecalhos,
      {},
    );
    expect(suspender.status).toBe(403);

    const remover = await enviar("DELETE", `/api/auth/usuarios/${outroDono.id}`, cabecalhos);
    expect(remover.status).toBe(403);

    const membro = await prisma.membro.findUniqueOrThrow({
      where: { organizacaoId_usuarioId: { organizacaoId: dono.pessoalId, usuarioId: outroDono.id } },
    });
    expect(membro.papel).toBe("dono");
    expect(membro.suspenso).toBe(false);
  });

  it("admin continua mudando o papel de outros admins e membros", async () => {
    const dono = await contaLogada("admin-age-dono");
    const admin = await contaLogada("admin-age-admin");
    const alvo = await contaLogada("admin-age-alvo");
    await adicionarComoMembro(dono.pessoalId, admin.id, "admin");
    await adicionarComoMembro(dono.pessoalId, alvo.id, "membro");
    const cabecalhos = await entrarEm(admin.cabecalhos, dono.pessoalId);

    const resposta = await enviar("PATCH", `/api/auth/usuarios/${alvo.id}`, cabecalhos, {
      papel: "admin",
    });
    expect(resposta.status).toBe(200);
    expect(await papelNoBanco(dono.pessoalId, alvo.id)).toBe("admin");
  });
});

describe("Gestão de organização — transferência", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("dono transfere: alvo vira dono, ele passa a admin e a sessão já sai com o papel novo", async () => {
    const dono = await contaLogada("transf-dono");
    const alvo = await contaLogada("transf-alvo");
    await adicionarComoMembro(dono.pessoalId, alvo.id, "membro");

    const resposta = await enviar(
      "POST",
      `/api/auth/organizacoes/${dono.pessoalId}/transferir`,
      dono.cabecalhos,
      { usuarioId: alvo.id, senha: SENHA_TESTE },
    );
    expect(resposta.status).toBe(200);
    expect(await papelNoBanco(dono.pessoalId, alvo.id)).toBe("dono");
    expect(await papelNoBanco(dono.pessoalId, dono.id)).toBe("admin");

    const cabecalhos = cabecalhosDaResposta(dono.cabecalhos, resposta);
    const me = await fetch(`${BASE_URL}/api/auth/me`, { headers: cabecalhos });
    expect((await me.json()).usuario.papelOrganizacao).toBe("admin");

    // Ex-dono não desfaz a transferência por baixo.
    const rebaixar = await enviar("PATCH", `/api/auth/usuarios/${alvo.id}`, cabecalhos, {
      papel: "membro",
    });
    expect(rebaixar.status).toBe(403);

    const evento = await prisma.logAuditoria.findFirst({
      where: { evento: "organizacao_transferida", usuarioId: alvo.id, autorId: dono.id },
    });
    expect(evento).not.toBeNull();
  });

  it("senha errada recusa a transferência sem mudar nada", async () => {
    const dono = await contaLogada("transf-senha-dono");
    const alvo = await contaLogada("transf-senha-alvo");
    await adicionarComoMembro(dono.pessoalId, alvo.id, "membro");

    const resposta = await enviar(
      "POST",
      `/api/auth/organizacoes/${dono.pessoalId}/transferir`,
      dono.cabecalhos,
      { usuarioId: alvo.id, senha: "SenhaErrada999!" },
    );
    expect(resposta.status).toBe(401);
    expect(await papelNoBanco(dono.pessoalId, dono.id)).toBe("dono");
    expect(await papelNoBanco(dono.pessoalId, alvo.id)).toBe("membro");
  });

  it("admin não transfere, e não dá pra transferir a quem está suspenso", async () => {
    const dono = await contaLogada("transf-regras-dono");
    const admin = await contaLogada("transf-regras-admin");
    const suspenso = await contaLogada("transf-regras-suspenso");
    await adicionarComoMembro(dono.pessoalId, admin.id, "admin");
    await prisma.membro.create({
      data: { organizacaoId: dono.pessoalId, usuarioId: suspenso.id, suspenso: true },
    });

    const cabecalhosAdmin = await entrarEm(admin.cabecalhos, dono.pessoalId);
    const peloAdmin = await enviar(
      "POST",
      `/api/auth/organizacoes/${dono.pessoalId}/transferir`,
      cabecalhosAdmin,
      { usuarioId: admin.id, senha: SENHA_TESTE },
    );
    expect(peloAdmin.status).toBe(403);

    const praSuspenso = await enviar(
      "POST",
      `/api/auth/organizacoes/${dono.pessoalId}/transferir`,
      dono.cabecalhos,
      { usuarioId: suspenso.id, senha: SENHA_TESTE },
    );
    expect(praSuspenso.status).toBe(409);
    expect(await papelNoBanco(dono.pessoalId, dono.id)).toBe("dono");
  });
});

describe("Gestão de organização — sair", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("membro sai de uma organização que não é a ativa e perde as sessões dela", async () => {
    const dono = await contaLogada("sair-dono");
    const membro = await contaLogada("sair-membro");
    await adicionarComoMembro(dono.pessoalId, membro.id, "membro");
    // Uma sessão dele na organização do dono, e depois volta pra pessoal.
    const naOrganizacao = await entrarEm(membro.cabecalhos, dono.pessoalId);
    const naPessoal = await entrarEm(naOrganizacao, membro.pessoalId);

    const resposta = await enviar(
      "POST",
      `/api/auth/organizacoes/${dono.pessoalId}/sair`,
      naPessoal,
    );
    expect(resposta.status).toBe(200);
    expect(await papelNoBanco(dono.pessoalId, membro.id)).toBeNull();
    expect(
      await prisma.tokenAtualizacao.count({
        where: { usuarioId: membro.id, organizacaoId: dono.pessoalId, revogadoEm: null },
      }),
    ).toBe(0);
    expect(await organizacaoAtiva(naPessoal)).toBe(membro.pessoalId);
  });

  it("sair da organização ativa reemite a sessão em outra", async () => {
    const dono = await contaLogada("sair-ativa-dono");
    const membro = await contaLogada("sair-ativa-membro");
    await adicionarComoMembro(dono.pessoalId, membro.id, "membro");
    const cabecalhos = await entrarEm(membro.cabecalhos, dono.pessoalId);

    const resposta = await enviar("POST", `/api/auth/organizacoes/${dono.pessoalId}/sair`, cabecalhos);
    expect(resposta.status).toBe(200);
    const novos = cabecalhosDaResposta(cabecalhos, resposta);
    expect(await organizacaoAtiva(novos)).toBe(membro.pessoalId);
  });

  it("único dono não sai (com ou sem outros membros), nem ninguém sai da única organização", async () => {
    const dono = await contaLogada("sair-regras-dono");

    const sozinho = await enviar("POST", `/api/auth/organizacoes/${dono.pessoalId}/sair`, dono.cabecalhos);
    expect(sozinho.status).toBe(409);

    const membro = await contaLogada("sair-regras-membro");
    await adicionarComoMembro(dono.pessoalId, membro.id, "membro");
    const comMembros = await enviar(
      "POST",
      `/api/auth/organizacoes/${dono.pessoalId}/sair`,
      dono.cabecalhos,
    );
    expect(comMembros.status).toBe(409);
    expect(await papelNoBanco(dono.pessoalId, dono.id)).toBe("dono");

    // O membro sem nenhuma outra organização.
    const cabecalhosMembro = await entrarEm(membro.cabecalhos, dono.pessoalId);
    await prisma.organizacao.delete({ where: { id: membro.pessoalId } });
    const unica = await enviar(
      "POST",
      `/api/auth/organizacoes/${dono.pessoalId}/sair`,
      cabecalhosMembro,
    );
    expect(unica.status).toBe(409);
    expect(await papelNoBanco(dono.pessoalId, membro.id)).toBe("membro");
  });
});

describe("Gestão de organização — renomear e excluir", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("admin renomeia mantendo o slug; membro recebe 403 e quem é de fora, 404", async () => {
    const dono = await contaLogada("renomear-dono");
    const admin = await contaLogada("renomear-admin");
    const membro = await contaLogada("renomear-membro");
    const fora = await contaLogada("renomear-fora");
    await adicionarComoMembro(dono.pessoalId, admin.id, "admin");
    await adicionarComoMembro(dono.pessoalId, membro.id, "membro");
    const { slug } = await prisma.organizacao.findUniqueOrThrow({ where: { id: dono.pessoalId } });

    const peloAdmin = await enviar("PATCH", `/api/auth/organizacoes/${dono.pessoalId}`, admin.cabecalhos, {
      nome: "Nome Novo",
    });
    expect(peloAdmin.status).toBe(200);
    const organizacao = await prisma.organizacao.findUniqueOrThrow({ where: { id: dono.pessoalId } });
    expect(organizacao.nome).toBe("Nome Novo");
    expect(organizacao.slug).toBe(slug);

    const peloMembro = await enviar("PATCH", `/api/auth/organizacoes/${dono.pessoalId}`, membro.cabecalhos, {
      nome: "Outro Nome",
    });
    expect(peloMembro.status).toBe(403);

    const deFora = await enviar("PATCH", `/api/auth/organizacoes/${dono.pessoalId}`, fora.cabecalhos, {
      nome: "Outro Nome",
    });
    expect(deFora.status).toBe(404);
  });

  it("dono exclui a organização ativa com a senha e a sessão cai na que sobrou", async () => {
    const dono = await contaLogada("excluir-dono");
    const membro = await contaLogada("excluir-membro");

    const criar = await enviar("POST", "/api/auth/organizacoes", dono.cabecalhos, { nome: "Descartável" });
    expect(criar.status).toBe(201);
    const { organizacao } = await criar.json();
    const cabecalhos = cabecalhosDaResposta(dono.cabecalhos, criar);
    await adicionarComoMembro(organizacao.id, membro.id, "membro");

    const resposta = await enviar("DELETE", `/api/auth/organizacoes/${organizacao.id}`, cabecalhos, {
      senha: SENHA_TESTE,
    });
    expect(resposta.status).toBe(200);
    expect(await prisma.organizacao.findUnique({ where: { id: organizacao.id } })).toBeNull();
    expect(await prisma.membro.count({ where: { organizacaoId: organizacao.id } })).toBe(0);
    // A conta do membro continua existindo.
    expect(await prisma.usuario.findUnique({ where: { id: membro.id } })).not.toBeNull();

    const novos = cabecalhosDaResposta(cabecalhos, resposta);
    expect(await organizacaoAtiva(novos)).toBe(dono.pessoalId);

    const evento = await prisma.logAuditoria.findFirst({
      where: { evento: "organizacao_excluida", usuarioId: dono.id },
    });
    expect(evento).not.toBeNull();
  });

  it("admin não exclui, senha errada não exclui e a única organização não é excluída", async () => {
    const dono = await contaLogada("excluir-regras-dono");
    const admin = await contaLogada("excluir-regras-admin");
    await adicionarComoMembro(dono.pessoalId, admin.id, "admin");

    const peloAdmin = await enviar("DELETE", `/api/auth/organizacoes/${dono.pessoalId}`, admin.cabecalhos, {
      senha: SENHA_TESTE,
    });
    expect(peloAdmin.status).toBe(403);

    // A pessoal é a única organização do dono.
    const unica = await enviar("DELETE", `/api/auth/organizacoes/${dono.pessoalId}`, dono.cabecalhos, {
      senha: SENHA_TESTE,
    });
    expect(unica.status).toBe(409);

    const criar = await enviar("POST", "/api/auth/organizacoes", dono.cabecalhos, { nome: "Outra" });
    expect(criar.status).toBe(201);
    const senhaErrada = await enviar("DELETE", `/api/auth/organizacoes/${dono.pessoalId}`, dono.cabecalhos, {
      senha: "SenhaErrada999!",
    });
    expect(senhaErrada.status).toBe(401);

    expect(await prisma.organizacao.findUnique({ where: { id: dono.pessoalId } })).not.toBeNull();
  });

  it("organização que gerencia aplicações não é excluída (as aplicações não ficam órfãs)", async () => {
    const dono = await contaLogada("excluir-com-aplicacao");
    const criar = await enviar("POST", "/api/auth/organizacoes", dono.cabecalhos, { nome: "Outra" });
    expect(criar.status).toBe(201);
    const aplicacao = await criarAplicacaoTeste("Aplicação da organização");
    await prisma.aplicacao.update({ where: { id: aplicacao.id }, data: { organizacaoDonaId: dono.pessoalId } });
    try {
      const resposta = await enviar("DELETE", `/api/auth/organizacoes/${dono.pessoalId}`, dono.cabecalhos, {
        senha: SENHA_TESTE,
      });
      expect(resposta.status).toBe(409);
      expect((await resposta.json()).erro).toContain("gerencia uma aplicação");
      expect(await prisma.organizacao.findUnique({ where: { id: dono.pessoalId } })).not.toBeNull();
      expect(
        (await prisma.aplicacao.findUniqueOrThrow({ where: { id: aplicacao.id } })).organizacaoDonaId,
      ).toBe(dono.pessoalId);
    } finally {
      await apagarAplicacoesTeste([aplicacao.id]);
    }
  });
});
