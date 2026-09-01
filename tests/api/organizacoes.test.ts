import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { gerarTokenConviteOrganizacao } from "@/lib/token";
import {
  apagarUsuariosTeste,
  BASE_URL,
  criarUsuarioTeste,
  ipAleatorio,
  loginTeste,
} from "../helpers";

const emailsCriados: string[] = [];

async function obterOrganizacaoDoUsuario(email: string) {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { email } });
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
    const emailConvidado = "convidado@teste.local";

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
    await fetch(`${BASE_URL}/api/auth/organizacoes/convites`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ email: emailConvidado, papel: "admin" }),
    });
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
    const alvoRegistro = await prisma.usuario.findUniqueOrThrow({ where: { email: jaMembro.email } });
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
    const donoRegistro = await prisma.usuario.findUniqueOrThrow({ where: { email: dono.email } });
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
    const donoRegistro = await prisma.usuario.findUniqueOrThrow({ where: { email: dono.email } });
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
    const donoRegistro = await prisma.usuario.findUniqueOrThrow({ where: { email: dono.email } });
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

    const convidadoRegistro = await prisma.usuario.findUniqueOrThrow({
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
    const emailConvidado = "sera-cancelado@teste.local";

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
    const emailAlvo = "alvo-de-spam@teste.local";

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
    const donoRegistro = await prisma.usuario.findUniqueOrThrow({ where: { email: dono.email } });
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

    const convidadoRegistro = await prisma.usuario.findUniqueOrThrow({
      where: { email: convidado.email },
    });
    const membro = await prisma.membro.findUnique({
      where: {
        organizacaoId_usuarioId: { organizacaoId, usuarioId: convidadoRegistro.id },
      },
    });
    expect(membro).not.toBeNull();
  });
});
