import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  apagarUsuariosTeste,
  BASE_URL,
  criarUsuarioTeste,
  ipAleatorio,
  loginTeste,
} from "../helpers";

const emailsCriados: string[] = [];

describe("Autoatendimento LGPD (GET/DELETE /api/auth/minha-conta)", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  async function exportar(cabecalhos: Record<string, string>, senha: string) {
    return fetch(`${BASE_URL}/api/auth/minha-conta/exportar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ senha }),
    });
  }

  it("sem autenticação retorna 401 tanto pra exportar quanto pra excluir", async () => {
    const respostaExportar = await fetch(`${BASE_URL}/api/auth/minha-conta/exportar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha: "qualquer" }),
    });
    expect(respostaExportar.status).toBe(401);

    const respostaExcluir = await fetch(`${BASE_URL}/api/auth/minha-conta`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha: "qualquer" }),
    });
    expect(respostaExcluir.status).toBe(401);
  });

  it("exige a senha atual pra exportar (senha errada → 401)", async () => {
    const usuario = await criarUsuarioTeste("minha-conta-exportar-senha");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await exportar(cabecalhos, "SenhaErrada999!");
    expect(resposta.status).toBe(401);
  });

  it("exporta os próprios dados sem vazar hash de senha nem segredo de MFA", async () => {
    const usuario = await criarUsuarioTeste("minha-conta-exportar");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await exportar(cabecalhos, usuario.senha);
    expect(resposta.status).toBe(200);

    const corpo = await resposta.json();
    expect(corpo.dadosPessoais.email).toBe(usuario.email);
    expect(corpo.dadosPessoais).not.toHaveProperty("senhaHash");
    expect(corpo.dadosPessoais).not.toHaveProperty("mfaSecret");
    expect(Array.isArray(corpo.sessoes)).toBe(true);
    expect(Array.isArray(corpo.logsAuditoria)).toBe(true);
    expect(Array.isArray(corpo.passkeys)).toBe(true);
    expect(Array.isArray(corpo.dispositivosConfiaveis)).toBe(true);
    expect(Array.isArray(corpo.codigosBackupMfa)).toBe(true);
    // A sessão usada pra chamar a rota já deve aparecer no próprio export.
    expect(corpo.sessoes.length).toBeGreaterThan(0);
    expect(JSON.stringify(corpo)).not.toContain(usuario.senha);
  });

  it("o export inclui os metadados das passkeys, sem credentialId nem publicKey", async () => {
    const usuario = await criarUsuarioTeste("minha-conta-passkey-export");
    emailsCriados.push(usuario.email);
    const registro = await prisma.usuario.findFirstOrThrow({ where: { email: usuario.email } });
    await prisma.passkeyCredencial.create({
      data: {
        usuarioId: registro.id,
        credentialId: `cred-${registro.id}`,
        publicKey: "chave-publica-cose-fake",
        transportes: ["internal", "hybrid"],
        nome: "Touch ID do teste",
      },
    });
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await exportar(cabecalhos, usuario.senha);
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();

    expect(corpo.passkeys).toHaveLength(1);
    expect(corpo.passkeys[0].nome).toBe("Touch ID do teste");
    expect(corpo.passkeys[0].transportes).toEqual(["internal", "hybrid"]);
    expect(corpo.passkeys[0]).not.toHaveProperty("credentialId");
    expect(corpo.passkeys[0]).not.toHaveProperty("publicKey");
    expect(JSON.stringify(corpo)).not.toContain("chave-publica-cose-fake");
  });

  it("exclui a própria conta com a senha correta e derruba a sessão", async () => {
    const usuario = await criarUsuarioTeste("minha-conta-excluir-ok");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/minha-conta`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ senha: usuario.senha }),
    });
    expect(resposta.status).toBe(200);

    const registroApagado = await prisma.usuario.findFirst({ where: { email: usuario.email } });
    expect(registroApagado).toBeNull();

    const loginApagado = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: usuario.email, senha: usuario.senha }),
    });
    expect(loginApagado.status).toBe(401);
  });

  it("excluir a conta tira e-mail, IP e navegador da auditoria e apaga webhooks com o e-mail", async () => {
    const usuario = await criarUsuarioTeste("minha-conta-anonimiza");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);
    const conta = await prisma.usuario.findFirstOrThrow({ where: { email: usuario.email } });
    const aplicacaoId = conta.aplicacaoId;

    // Um de cada caso: evento próprio, falha de login só com o e-mail, a
    // pessoa como alvo de um admin, a pessoa agindo sobre outra conta.
    const proprio = await prisma.logAuditoria.create({
      data: { aplicacaoId, usuarioId: conta.id, email: usuario.email, evento: "login_sucesso", ip: "203.0.113.1", userAgent: "navegador-dela" },
    });
    const soEmail = await prisma.logAuditoria.create({
      data: { aplicacaoId, email: usuario.email, evento: "login_falha", ip: "203.0.113.2", userAgent: "navegador-dela" },
    });
    const alvo = await prisma.logAuditoria.create({
      data: { aplicacaoId, usuarioId: conta.id, email: usuario.email, evento: "usuario_suspenso", ip: "198.51.100.9", userAgent: "navegador-do-admin", autorId: "admin-x", autorEmail: "admin@exemplo.com" },
    });
    const autora = await prisma.logAuditoria.create({
      data: { aplicacaoId, usuarioId: "outra-conta", email: "outra@exemplo.com", evento: "usuario_suspenso", ip: "203.0.113.3", userAgent: "navegador-dela", autorId: conta.id, autorEmail: usuario.email },
    });
    const outraPessoa = await prisma.logAuditoria.create({
      data: { aplicacaoId, usuarioId: "outra-conta", email: "outra@exemplo.com", evento: "login_sucesso", ip: "203.0.113.4", userAgent: "outro-navegador" },
    });

    const webhook = await prisma.webhookAplicacao.create({
      data: { aplicacaoId, url: "https://exemplo.invalid/hook", segredoCifrado: "x", eventos: [], ativo: false },
    });
    try {
      const comEmail = await prisma.entregaWebhook.create({
        data: { webhookId: webhook.id, evento: "usuario.criado", payload: { evento: "usuario.criado", dados: { usuario: { id: conta.id, email: usuario.email } } }, entregueEm: new Date() },
      });
      const deOutro = await prisma.entregaWebhook.create({
        data: { webhookId: webhook.id, evento: "usuario.criado", payload: { evento: "usuario.criado", dados: { usuario: { id: "outra-conta", email: "outra@exemplo.com" } } }, entregueEm: new Date() },
      });

      const resposta = await fetch(`${BASE_URL}/api/auth/minha-conta`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...cabecalhos },
        body: JSON.stringify({ senha: usuario.senha }),
      });
      expect(resposta.status).toBe(200);

      const ler = (id: string) => prisma.logAuditoria.findUniqueOrThrow({ where: { id } });
      expect(await ler(proprio.id)).toMatchObject({ usuarioId: conta.id, email: null, ip: null, userAgent: null, evento: "login_sucesso" });
      expect(await ler(soEmail.id)).toMatchObject({ email: null, ip: null, userAgent: null });
      expect(await ler(alvo.id)).toMatchObject({ email: null, ip: "198.51.100.9", userAgent: "navegador-do-admin", autorEmail: "admin@exemplo.com" });
      expect(await ler(autora.id)).toMatchObject({ autorId: conta.id, autorEmail: null, ip: null, userAgent: null, email: "outra@exemplo.com" });
      expect(await ler(outraPessoa.id)).toMatchObject({ email: "outra@exemplo.com", ip: "203.0.113.4" });

      const exclusao = await prisma.logAuditoria.findFirstOrThrow({ where: { usuarioId: conta.id, evento: "conta_excluida_pelo_titular" } });
      expect(exclusao).toMatchObject({ email: null, ip: null, userAgent: null, aplicacaoId });
      expect(await prisma.logAuditoria.count({ where: { OR: [{ email: usuario.email }, { autorEmail: usuario.email }] } })).toBe(0);

      expect(await prisma.entregaWebhook.findUnique({ where: { id: comEmail.id } })).toBeNull();
      expect(await prisma.entregaWebhook.findUnique({ where: { id: deOutro.id } })).not.toBeNull();
    } finally {
      await prisma.logAuditoria.deleteMany({ where: { id: { in: [proprio.id, soEmail.id, alvo.id, autora.id, outraPessoa.id] } } });
      await prisma.webhookAplicacao.delete({ where: { id: webhook.id } });
    }
  });

  it("rejeita exclusão com senha incorreta e mantém a conta", async () => {
    const usuario = await criarUsuarioTeste("minha-conta-excluir-senha-errada");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/minha-conta`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ senha: "SenhaErrada999!" }),
    });
    expect(resposta.status).toBe(401);

    const registroAinda = await prisma.usuario.findFirst({ where: { email: usuario.email } });
    expect(registroAinda).not.toBeNull();
  });

  it("bloqueia exclusão sem o token CSRF", async () => {
    const usuario = await criarUsuarioTeste("minha-conta-sem-csrf");
    emailsCriados.push(usuario.email);
    const { cookies } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/minha-conta`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Cookie: `tokenAcesso=${cookies.tokenAcesso}; csrfToken=${cookies.csrfToken}`,
      },
      body: JSON.stringify({ senha: usuario.senha }),
    });
    expect(resposta.status).toBe(403);
  });

  it("o export inclui as organizações de que a pessoa é membro", async () => {
    const usuario = await criarUsuarioTeste("minha-conta-export-org");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await exportar(cabecalhos, usuario.senha);
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();

    // Toda conta ganha a organização pessoal no cadastro, como dona.
    expect(Array.isArray(corpo.organizacoes)).toBe(true);
    expect(corpo.organizacoes).toHaveLength(1);
    expect(corpo.organizacoes[0].papel).toBe("dono");
    expect(Array.isArray(corpo.convitesCriados)).toBe(true);
  });

  it("exclui a própria conta e apaga a organização pessoal órfã junto", async () => {
    const usuario = await criarUsuarioTeste("minha-conta-excluir-org-orfa");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const registro = await prisma.usuario.findFirstOrThrow({ where: { email: usuario.email } });
    const membro = await prisma.membro.findFirstOrThrow({ where: { usuarioId: registro.id } });
    const organizacaoId = membro.organizacaoId;

    const resposta = await fetch(`${BASE_URL}/api/auth/minha-conta`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ senha: usuario.senha }),
    });
    expect(resposta.status).toBe(200);

    const organizacaoRestante = await prisma.organizacao.findUnique({
      where: { id: organizacaoId },
    });
    expect(organizacaoRestante).toBeNull();

    // Os projetos e tarefas dela no Django entram na fila de exclusão, na
    // mesma transação. Aqui o Django não está rodando, então o pedido fica
    // pendente pro job de limpeza (o envio em si é testado em
    // tests/lib/exclusaoDominio.test.ts).
    const alvos = [`organizacao:${organizacaoId}`, `usuario:${registro.id}`];
    const pendentes = await prisma.exclusaoDominioPendente.findMany({ where: { alvo: { in: alvos } } });
    expect(pendentes.map((p) => p.alvo).sort()).toEqual(alvos.sort());
    await prisma.exclusaoDominioPendente.deleteMany({ where: { alvo: { in: alvos } } });
  });

  it("bloqueia exclusão sendo a única pessoa dona de uma organização com outros membros", async () => {
    const dono = await criarUsuarioTeste("minha-conta-dono-bloqueado");
    emailsCriados.push(dono.email);
    const outroMembro = await criarUsuarioTeste("minha-conta-outro-membro");
    emailsCriados.push(outroMembro.email);
    const { cabecalhos } = await loginTeste(dono.email, dono.senha);

    const registroDono = await prisma.usuario.findFirstOrThrow({ where: { email: dono.email } });
    const registroOutro = await prisma.usuario.findFirstOrThrow({
      where: { email: outroMembro.email },
    });
    const membroDono = await prisma.membro.findFirstOrThrow({
      where: { usuarioId: registroDono.id },
    });
    await prisma.membro.create({
      data: { organizacaoId: membroDono.organizacaoId, usuarioId: registroOutro.id, papel: "membro" },
    });

    const resposta = await fetch(`${BASE_URL}/api/auth/minha-conta`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ senha: dono.senha }),
    });
    expect(resposta.status).toBe(409);

    const registroAinda = await prisma.usuario.findFirst({ where: { email: dono.email } });
    expect(registroAinda).not.toBeNull();
  });

  it("bloqueia com 429 após estourar tentativas de senha errada", async () => {
    const usuario = await criarUsuarioTeste("minha-conta-rate-limit");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);
    const ip = ipAleatorio();

    async function tentarSenhaErrada() {
      return fetch(`${BASE_URL}/api/auth/minha-conta`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...cabecalhos, "X-Forwarded-For": ip },
        body: JSON.stringify({ senha: "SenhaErrada999!" }),
      });
    }

    for (let i = 0; i < 5; i++) {
      const resposta = await tentarSenhaErrada();
      expect(resposta.status).toBe(401);
    }

    const sexta = await tentarSenhaErrada();
    expect(sexta.status).toBe(429);
  }, 45000);
});
