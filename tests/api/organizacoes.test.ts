import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { gerarTokenConviteOrganizacao } from "@/lib/token";
import {
  apagarAplicacoesTeste,
  apagarUsuariosTeste,
  BASE_URL,
  cabecalhosAplicacao,
  criarAplicacaoTeste,
  criarUsuarioTeste,
  gerarEmailTeste,
  ipAleatorio,
  loginTeste,
} from "../helpers";

const emailsCriados: string[] = [];

async function obterOrganizacaoDoUsuario(email: string) {
  const usuario = await prisma.usuario.findFirstOrThrow({ where: { email } });
  const membro = await prisma.membro.findFirstOrThrow({
    where: { usuarioId: usuario.id },
    orderBy: { criadoEm: "asc" },
  });
  return { usuario, organizacaoId: membro.organizacaoId };
}

describe("Organizações — criar, listar, trocar", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("conta sem NENHUMA organização entra e ganha a organização pessoal (não 500)", async () => {
    // Reproduz o caso real de produção (2026-09-15): conta criada pelo código
    // anterior ao multi-tenant depois do backfill ficava sem Membro, e o login
    // respondia 500 sem corpo ("Unexpected end of JSON input" na tela).
    const orfa = await criarUsuarioTeste("org-conta-orfa");
    emailsCriados.push(orfa.email);
    const { usuario } = await obterOrganizacaoDoUsuario(orfa.email);
    await prisma.organizacao.deleteMany({ where: { membros: { some: { usuarioId: usuario.id } } } });
    expect(await prisma.membro.count({ where: { usuarioId: usuario.id } })).toBe(0);

    const { resposta } = await loginTeste(orfa.email, orfa.senha);
    expect(resposta.status).toBe(200);

    const membros = await prisma.membro.findMany({
      where: { usuarioId: usuario.id },
      include: { organizacao: true },
    });
    expect(membros).toHaveLength(1);
    expect(membros[0].papel).toBe("dono");
    expect(membros[0].organizacao.aplicacaoId).toBe(usuario.aplicacaoId);

    // Segundo login não cria outra.
    await loginTeste(orfa.email, orfa.senha);
    expect(await prisma.membro.count({ where: { usuarioId: usuario.id } })).toBe(1);
  });

  it("cria organização nova e já entra nela (sessão reemitida)", async () => {
    const dono = await criarUsuarioTeste("org-criar");
    emailsCriados.push(dono.email);
    const { cabecalhos } = await loginTeste(dono.email, dono.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/organizacoes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ nome: "Acme Inc" }),
    });
    expect(resposta.status).toBe(201);
    const corpo = await resposta.json();
    expect(corpo.organizacao.nome).toBe("Acme Inc");
    expect(corpo.tokenAcesso).toBeTruthy();
  });

  it("lista as organizações de que o usuário é membro (pessoal + criadas)", async () => {
    const dono = await criarUsuarioTeste("org-listar");
    emailsCriados.push(dono.email);
    const { cabecalhos } = await loginTeste(dono.email, dono.senha);

    await fetch(`${BASE_URL}/api/auth/organizacoes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ nome: "Segunda organização" }),
    });

    const resposta = await fetch(`${BASE_URL}/api/auth/organizacoes`, { headers: cabecalhos });
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(corpo.organizacoes.length).toBeGreaterThanOrEqual(2);
    expect(corpo.organizacoes.every((o: { papel: string }) => o.papel === "dono")).toBe(true);
  });

  it("troca a organização ativa pra outra de que já é membro", async () => {
    const dono = await criarUsuarioTeste("org-trocar");
    emailsCriados.push(dono.email);
    const { cabecalhos } = await loginTeste(dono.email, dono.senha);

    const respostaCriar = await fetch(`${BASE_URL}/api/auth/organizacoes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ nome: "Organização B" }),
    });
    const { organizacao } = await respostaCriar.json();

    const respostaEntrar = await fetch(
      `${BASE_URL}/api/auth/organizacoes/${organizacao.id}/entrar`,
      { method: "POST", headers: cabecalhos },
    );
    expect(respostaEntrar.status).toBe(200);
  });

  it("não deixa entrar numa organização de que não é membro", async () => {
    const usuario = await criarUsuarioTeste("org-entrar-negado");
    const outraOrg = await criarUsuarioTeste("org-entrar-alvo");
    emailsCriados.push(usuario.email, outraOrg.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);
    const { organizacaoId } = await obterOrganizacaoDoUsuario(outraOrg.email);

    const resposta = await fetch(`${BASE_URL}/api/auth/organizacoes/${organizacaoId}/entrar`, {
      method: "POST",
      headers: cabecalhos,
    });
    expect(resposta.status).toBe(404);
  });

  it("bloqueia com 429 depois de criar organizações demais do mesmo IP", async () => {
    const dono = await criarUsuarioTeste("org-rate-limit");
    emailsCriados.push(dono.email);
    const ip = ipAleatorio();
    const { cabecalhos } = await loginTeste(dono.email, dono.senha, ip);

    async function criar() {
      return fetch(`${BASE_URL}/api/auth/organizacoes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": ip, ...cabecalhos },
        body: JSON.stringify({ nome: `Org ${Math.random()}` }),
      });
    }

    for (let i = 0; i < 10; i++) {
      const resposta = await criar();
      expect(resposta.status).toBe(201);
    }
    const decimaPrimeira = await criar();
    expect(decimaPrimeira.status).toBe(429);
  }, 30000);
});

describe("Convites de organização", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("membro comum recebe 403 ao tentar convidar", async () => {
    const usuario = await criarUsuarioTeste("convite-403");
    emailsCriados.push(usuario.email);
    const { usuario: registro, organizacaoId } = await obterOrganizacaoDoUsuario(usuario.email);
    await prisma.membro.update({
      where: { organizacaoId_usuarioId: { organizacaoId, usuarioId: registro.id } },
      data: { papel: "membro" },
    });
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/organizacoes/convites`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ email: "alguem@teste.local", papel: "membro" }),
    });
    expect(resposta.status).toBe(403);
  });

  it("dono cria convite, aparece na lista de pendentes, e não deixa convidar quem já é membro", async () => {
    const dono = await criarUsuarioTeste("convite-criar");
    emailsCriados.push(dono.email);
    const { cabecalhos } = await loginTeste(dono.email, dono.senha);
    // Único por execução: o limite de convites por e-mail-alvo (5/h) sobrevive
    // entre rodadas no banco de teste, e com endereço fixo o segundo convite
    // abaixo voltava 429 em silêncio.
    const emailConvidado = gerarEmailTeste("convidado");

    const respostaCriar = await fetch(`${BASE_URL}/api/auth/organizacoes/convites`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ email: emailConvidado, papel: "membro" }),
    });
    expect(respostaCriar.status).toBe(201);

    const respostaLista = await fetch(`${BASE_URL}/api/auth/organizacoes/convites`, {
      headers: cabecalhos,
    });
    const corpoLista = await respostaLista.json();
    expect(corpoLista.convites.some((c: { email: string }) => c.email === emailConvidado)).toBe(
      true,
    );

    // Convidar de novo pro MESMO e-mail reaproveita a linha, não duplica.
    const respostaReconvidar = await fetch(`${BASE_URL}/api/auth/organizacoes/convites`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ email: emailConvidado, papel: "admin" }),
    });
    expect(respostaReconvidar.status).toBe(201);
    const respostaLista2 = await fetch(`${BASE_URL}/api/auth/organizacoes/convites`, {
      headers: cabecalhos,
    });
    const corpoLista2 = await respostaLista2.json();
    const paraEsteEmail = corpoLista2.convites.filter(
      (c: { email: string }) => c.email === emailConvidado,
    );
    expect(paraEsteEmail).toHaveLength(1);
    expect(paraEsteEmail[0].papel).toBe("admin");
  });

  it("não deixa convidar um e-mail que já é membro da organização", async () => {
    const dono = await criarUsuarioTeste("convite-ja-membro-dono");
    const jaMembro = await criarUsuarioTeste("convite-ja-membro-alvo");
    emailsCriados.push(dono.email, jaMembro.email);
    const { organizacaoId } = await obterOrganizacaoDoUsuario(dono.email);
    const alvoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: jaMembro.email } });
    await prisma.membro.create({
      data: { organizacaoId, usuarioId: alvoRegistro.id, papel: "membro" },
    });
    const { cabecalhos } = await loginTeste(dono.email, dono.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/organizacoes/convites`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ email: jaMembro.email, papel: "membro" }),
    });
    expect(resposta.status).toBe(409);
  });

  it("aceitar convite sem estar autenticado retorna 401", async () => {
    const dono = await criarUsuarioTeste("convite-aceitar-401");
    emailsCriados.push(dono.email);
    const { organizacaoId } = await obterOrganizacaoDoUsuario(dono.email);
    const donoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: dono.email } });
    const convite = await prisma.conviteOrganizacao.create({
      data: { organizacaoId, email: "novo@teste.local", papel: "membro", criadoPorId: donoRegistro.id },
    });
    const token = await gerarTokenConviteOrganizacao({
      conviteId: convite.id,
      organizacaoId,
      email: "novo@teste.local",
      papel: "membro",
    });

    const resposta = await fetch(`${BASE_URL}/api/auth/organizacoes/aceitar-convite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(resposta.status).toBe(401);
  });

  it("aceitar convite com uma conta de e-mail diferente do convite retorna 403", async () => {
    const dono = await criarUsuarioTeste("convite-email-errado-dono");
    const outraConta = await criarUsuarioTeste("convite-email-errado-alvo");
    emailsCriados.push(dono.email, outraConta.email);
    const { organizacaoId } = await obterOrganizacaoDoUsuario(dono.email);
    const donoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: dono.email } });
    const convite = await prisma.conviteOrganizacao.create({
      data: {
        organizacaoId,
        email: "destinatario-de-verdade@teste.local",
        papel: "membro",
        criadoPorId: donoRegistro.id,
      },
    });
    const token = await gerarTokenConviteOrganizacao({
      conviteId: convite.id,
      organizacaoId,
      email: "destinatario-de-verdade@teste.local",
      papel: "membro",
    });

    const { cabecalhos } = await loginTeste(outraConta.email, outraConta.senha);
    const resposta = await fetch(`${BASE_URL}/api/auth/organizacoes/aceitar-convite`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ token }),
    });
    expect(resposta.status).toBe(403);
  });

  it("aceita o convite, vira membro, e o mesmo token não funciona de novo", async () => {
    const dono = await criarUsuarioTeste("convite-aceitar-ok-dono");
    const convidado = await criarUsuarioTeste("convite-aceitar-ok-alvo");
    emailsCriados.push(dono.email, convidado.email);
    const { organizacaoId } = await obterOrganizacaoDoUsuario(dono.email);
    const donoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: dono.email } });
    const convite = await prisma.conviteOrganizacao.create({
      data: { organizacaoId, email: convidado.email, papel: "admin", criadoPorId: donoRegistro.id },
    });
    const token = await gerarTokenConviteOrganizacao({
      conviteId: convite.id,
      organizacaoId,
      email: convidado.email,
      papel: "admin",
    });

    const { cabecalhos } = await loginTeste(convidado.email, convidado.senha);
    const respostaAceitar = await fetch(`${BASE_URL}/api/auth/organizacoes/aceitar-convite`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ token }),
    });
    expect(respostaAceitar.status).toBe(200);

    const convidadoRegistro = await prisma.usuario.findFirstOrThrow({
      where: { email: convidado.email },
    });
    const membro = await prisma.membro.findUnique({
      where: {
        organizacaoId_usuarioId: { organizacaoId, usuarioId: convidadoRegistro.id },
      },
    });
    expect(membro?.papel).toBe("admin");

    const respostaReuso = await fetch(`${BASE_URL}/api/auth/organizacoes/aceitar-convite`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ token }),
    });
    expect(respostaReuso.status).toBe(400);
  });

  it("cancela um convite pendente — aceitar depois disso não funciona mais", async () => {
    const dono = await criarUsuarioTeste("convite-cancelar");
    emailsCriados.push(dono.email);
    const { cabecalhos } = await loginTeste(dono.email, dono.senha);
    const { organizacaoId } = await obterOrganizacaoDoUsuario(dono.email);
    // Único por execução — mesmo motivo do teste de criar convite acima.
    const emailConvidado = gerarEmailTeste("sera-cancelado");

    const respostaCriar = await fetch(`${BASE_URL}/api/auth/organizacoes/convites`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ email: emailConvidado, papel: "membro" }),
    });
    const { convite } = await respostaCriar.json();
    const token = await gerarTokenConviteOrganizacao({
      conviteId: convite.id,
      organizacaoId,
      email: emailConvidado,
      papel: "membro",
    });

    const respostaCancelar = await fetch(
      `${BASE_URL}/api/auth/organizacoes/convites/${convite.id}`,
      { method: "DELETE", headers: cabecalhos },
    );
    expect(respostaCancelar.status).toBe(200);

    const respostaLista = await fetch(`${BASE_URL}/api/auth/organizacoes/convites`, {
      headers: cabecalhos,
    });
    const corpoLista = await respostaLista.json();
    expect(corpoLista.convites.some((c: { id: string }) => c.id === convite.id)).toBe(false);

    // O link já mandado (se tivesse sido) não funciona mais — cria a conta
    // com o e-mail EXATO do convite (criarUsuarioTeste gera um e-mail
    // aleatório, então cadastra direto aqui) pra tentar aceitar mesmo assim.
    emailsCriados.push(emailConvidado);
    const respostaCadastro = await fetch(`${BASE_URL}/api/auth/cadastro`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ipAleatorio() },
      body: JSON.stringify({
        nome: "Convidado cancelado",
        email: emailConvidado,
        senha: "SenhaForte123!",
      }),
    });
    expect(respostaCadastro.status).toBe(201);
    const { cabecalhos: cabecalhosNovo } = await loginTeste(emailConvidado, "SenhaForte123!");
    const respostaAceitar = await fetch(`${BASE_URL}/api/auth/organizacoes/aceitar-convite`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhosNovo },
      body: JSON.stringify({ token }),
    });
    expect(respostaAceitar.status).toBe(400);
  });

  it("bloqueia com 429 depois de convidar o MESMO e-mail várias vezes", async () => {
    const dono = await criarUsuarioTeste("convite-rate-limit-email");
    emailsCriados.push(dono.email);
    const { cabecalhos } = await loginTeste(dono.email, dono.senha);
    // Único por execução: o contador por e-mail-alvo dura 1h no banco de
    // teste, e um endereço fixo fazia a segunda rodada da suíte dentro dessa
    // hora receber 429 já no primeiro convite.
    const emailAlvo = gerarEmailTeste("alvo-de-spam");

    async function convidar() {
      return fetch(`${BASE_URL}/api/auth/organizacoes/convites`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": ipAleatorio(), ...cabecalhos },
        body: JSON.stringify({ email: emailAlvo, papel: "membro" }),
      });
    }

    for (let i = 0; i < 5; i++) {
      const resposta = await convidar();
      expect(resposta.status).toBe(201);
    }
    const sexta = await convidar();
    expect(sexta.status).toBe(429);
  }, 30000);

  it("aceitar o mesmo convite duas vezes ao mesmo tempo não gera 500", async () => {
    const dono = await criarUsuarioTeste("convite-corrida-dono");
    const convidado = await criarUsuarioTeste("convite-corrida-alvo");
    emailsCriados.push(dono.email, convidado.email);
    const { organizacaoId } = await obterOrganizacaoDoUsuario(dono.email);
    const donoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: dono.email } });
    const convite = await prisma.conviteOrganizacao.create({
      data: { organizacaoId, email: convidado.email, papel: "membro", criadoPorId: donoRegistro.id },
    });
    const token = await gerarTokenConviteOrganizacao({
      conviteId: convite.id,
      organizacaoId,
      email: convidado.email,
      papel: "membro",
    });

    const { cabecalhos } = await loginTeste(convidado.email, convidado.senha);
    const aceitar = () =>
      fetch(`${BASE_URL}/api/auth/organizacoes/aceitar-convite`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecalhos },
        body: JSON.stringify({ token }),
      });

    const [respostaA, respostaB] = await Promise.all([aceitar(), aceitar()]);
    // As duas costumam passar pela checagem de "já é membro" antes de
    // qualquer uma escrever (é exatamente a corrida que o catch de P2002
    // existe pra cobrir) — então normalmente as DUAS voltam 200. O que
    // importa aqui é que nenhuma delas estoura 500.
    expect(respostaA.status).not.toBe(500);
    expect(respostaB.status).not.toBe(500);
    expect([respostaA.status, respostaB.status]).toContain(200);

    const convidadoRegistro = await prisma.usuario.findFirstOrThrow({
      where: { email: convidado.email },
    });
    const membro = await prisma.membro.findUnique({
      where: {
        organizacaoId_usuarioId: { organizacaoId, usuarioId: convidadoRegistro.id },
      },
    });
    expect(membro).not.toBeNull();
  });

  it("convite de organização de OUTRA aplicação é recusado, mesmo com o e-mail certo", async () => {
    // O e-mail só é único dentro da aplicação: a mesma pessoa com conta em
    // dois clientes não pode, logada no cliente B, entrar numa organização do
    // cliente A aceitando o convite dela.
    const dono = await criarUsuarioTeste("convite-outra-app-dono");
    emailsCriados.push(dono.email);
    const { organizacaoId } = await obterOrganizacaoDoUsuario(dono.email);
    const donoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: dono.email } });

    const outraAplicacao = await criarAplicacaoTeste("Outro cliente");
    try {
      const email = gerarEmailTeste("convite-outra-app-alvo");
      const comApp = cabecalhosAplicacao(outraAplicacao);
      await fetch(`${BASE_URL}/api/auth/cadastro`, {
        method: "POST",
        headers: comApp,
        body: JSON.stringify({ nome: "Pessoa do cliente B", email, senha: "SenhaForte123!" }),
      });
      const login = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: comApp,
        body: JSON.stringify({ email, senha: "SenhaForte123!" }),
      });
      expect(login.status).toBe(200);
      // Conta de aplicação cliente: tokens no corpo (como o SDK usa), sem cookie.
      const { tokenAcesso } = await login.json();

      const convite = await prisma.conviteOrganizacao.create({
        data: { organizacaoId, email, papel: "membro", criadoPorId: donoRegistro.id },
      });
      const token = await gerarTokenConviteOrganizacao({ conviteId: convite.id, organizacaoId, email, papel: "membro" });

      const resposta = await fetch(`${BASE_URL}/api/auth/organizacoes/aceitar-convite`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenAcesso}` },
        body: JSON.stringify({ token }),
      });
      expect(resposta.status).toBe(403);
      expect(await prisma.membro.count({ where: { organizacaoId, usuario: { email } } })).toBe(0);
    } finally {
      await apagarAplicacoesTeste([outraAplicacao.id]);
    }
  });

  it("aceitar convite de organização em que a pessoa está suspensa responde 403, não 500", async () => {
    const dono = await criarUsuarioTeste("convite-suspenso-dono");
    const convidado = await criarUsuarioTeste("convite-suspenso-alvo");
    emailsCriados.push(dono.email, convidado.email);
    const { organizacaoId } = await obterOrganizacaoDoUsuario(dono.email);
    const donoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: dono.email } });
    const convidadoRegistro = await prisma.usuario.findFirstOrThrow({ where: { email: convidado.email } });
    await prisma.membro.create({
      data: { organizacaoId, usuarioId: convidadoRegistro.id, papel: "membro", suspenso: true },
    });
    const convite = await prisma.conviteOrganizacao.create({
      data: { organizacaoId, email: convidado.email, papel: "membro", criadoPorId: donoRegistro.id },
    });
    const token = await gerarTokenConviteOrganizacao({
      conviteId: convite.id,
      organizacaoId,
      email: convidado.email,
      papel: "membro",
    });
    const { cabecalhos } = await loginTeste(convidado.email, convidado.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/organizacoes/aceitar-convite`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ token }),
    });
    expect(resposta.status).toBe(403);
  });
});

describe("Convites recebidos no painel", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  const ROTA = `${BASE_URL}/api/auth/organizacoes/convites-recebidos`;

  // Dono com organização + convidado já cadastrado, com o convite no banco.
  async function cenario(prefixo: string, { verificado = true, diasAtras = 0 } = {}) {
    const dono = await criarUsuarioTeste(`${prefixo}-dono`);
    const convidado = await criarUsuarioTeste(`${prefixo}-alvo`);
    emailsCriados.push(dono.email, convidado.email);
    const { organizacaoId, usuario: donoRegistro } = await obterOrganizacaoDoUsuario(dono.email);
    await prisma.organizacao.update({ where: { id: organizacaoId }, data: { nome: `Org de ${prefixo}` } });
    await prisma.usuario.updateMany({ where: { email: convidado.email }, data: { emailVerificado: verificado } });
    const convite = await prisma.conviteOrganizacao.create({
      data: {
        organizacaoId,
        email: convidado.email,
        papel: "admin",
        criadoPorId: donoRegistro.id,
        criadoEm: new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000),
      },
    });
    const { cabecalhos } = await loginTeste(convidado.email, convidado.senha);
    return { dono, convidado, organizacaoId, convite, cabecalhos };
  }

  it("quem tem conta verificada vê o convite no painel, aceita e vira membro", async () => {
    const { convidado, organizacaoId, convite, cabecalhos } = await cenario("recebido-aceitar");

    const lista = await fetch(ROTA, { headers: cabecalhos });
    expect(lista.status).toBe(200);
    const corpo = await lista.json();
    expect(corpo.emailVerificado).toBe(true);
    expect(corpo.convites).toEqual([
      expect.objectContaining({
        id: convite.id,
        papel: "admin",
        organizacaoNome: "Org de recebido-aceitar",
        convidadoPorNome: "Usuário de teste",
      }),
    ]);

    const aceitar = await fetch(`${ROTA}/${convite.id}`, { method: "POST", headers: cabecalhos });
    expect(aceitar.status).toBe(200);
    const membro = await prisma.membro.findFirst({ where: { organizacaoId, usuario: { email: convidado.email } } });
    expect(membro?.papel).toBe("admin");

    const depois = await (await fetch(ROTA, { headers: cabecalhos })).json();
    expect(depois.convites).toEqual([]);
    expect((await fetch(`${ROTA}/${convite.id}`, { method: "POST", headers: cabecalhos })).status).toBe(404);
  });

  it("e-mail não verificado não vê nem aceita: a conta pode ter sido criada com o e-mail de outra pessoa", async () => {
    const { convidado, organizacaoId, convite, cabecalhos } = await cenario("recebido-nao-verificado", { verificado: false });

    const corpo = await (await fetch(ROTA, { headers: cabecalhos })).json();
    expect(corpo).toEqual({ convites: [], emailVerificado: false });

    expect((await fetch(`${ROTA}/${convite.id}`, { method: "POST", headers: cabecalhos })).status).toBe(403);
    expect((await fetch(`${ROTA}/${convite.id}`, { method: "DELETE", headers: cabecalhos })).status).toBe(403);
    expect(await prisma.membro.count({ where: { organizacaoId, usuario: { email: convidado.email } } })).toBe(0);
    expect(await prisma.conviteOrganizacao.count({ where: { id: convite.id } })).toBe(1);
  });

  it("outra conta não vê, não aceita e não recusa o convite de ninguém (404)", async () => {
    const { organizacaoId, convite } = await cenario("recebido-alheio");
    const intruso = await criarUsuarioTeste("recebido-alheio-intruso");
    emailsCriados.push(intruso.email);
    await prisma.usuario.updateMany({ where: { email: intruso.email }, data: { emailVerificado: true } });
    const { cabecalhos } = await loginTeste(intruso.email, intruso.senha);

    expect((await (await fetch(ROTA, { headers: cabecalhos })).json()).convites).toEqual([]);
    expect((await fetch(`${ROTA}/${convite.id}`, { method: "POST", headers: cabecalhos })).status).toBe(404);
    expect((await fetch(`${ROTA}/${convite.id}`, { method: "DELETE", headers: cabecalhos })).status).toBe(404);
    expect(await prisma.membro.count({ where: { organizacaoId, usuario: { email: intruso.email } } })).toBe(0);
    expect(await prisma.conviteOrganizacao.count({ where: { id: convite.id } })).toBe(1);
  });

  it("recusar apaga o convite e o link do e-mail deixa de funcionar", async () => {
    const { convidado, organizacaoId, convite, cabecalhos } = await cenario("recebido-recusar");
    const token = await gerarTokenConviteOrganizacao({
      conviteId: convite.id,
      organizacaoId,
      email: convidado.email,
      papel: "admin",
    });

    expect((await fetch(`${ROTA}/${convite.id}`, { method: "DELETE", headers: cabecalhos })).status).toBe(200);
    expect(await prisma.conviteOrganizacao.count({ where: { id: convite.id } })).toBe(0);

    const peloLink = await fetch(`${BASE_URL}/api/auth/organizacoes/aceitar-convite`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ token }),
    });
    expect(peloLink.status).toBe(400);
  });

  it("convite com mais de 7 dias (link vencido) não aparece nem pode ser aceito", async () => {
    const { convite, cabecalhos } = await cenario("recebido-vencido", { diasAtras: 8 });
    expect((await (await fetch(ROTA, { headers: cabecalhos })).json()).convites).toEqual([]);
    expect((await fetch(`${ROTA}/${convite.id}`, { method: "POST", headers: cabecalhos })).status).toBe(404);
  });

  it("sem sessão, 401", async () => {
    expect((await fetch(ROTA)).status).toBe(401);
  });
});
