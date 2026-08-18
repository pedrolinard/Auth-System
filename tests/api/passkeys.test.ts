import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { apagarUsuariosTeste, BASE_URL, criarUsuarioTeste, loginTeste } from "../helpers";

const emailsCriados: string[] = [];

// A ceremônia WebAuthn de verdade (assinatura criptográfica real) é coberta
// em tests-e2e/passkeys.spec.ts, via virtual authenticator do Chrome DevTools
// Protocol — não dá pra simular aqui, que bate só nas rotas de API sem
// browser. Esta suíte cobre tudo que NÃO depende de uma assinatura válida:
// guarda de autenticação/CSRF, formato das opções geradas, posse (ownership)
// da passkey e rejeição de respostas malformadas/desconhecidas.
describe("Passkeys (WebAuthn) — rotas de API", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("sem autenticação retorna 401 em todas as rotas autenticadas", async () => {
    const respostaListar = await fetch(`${BASE_URL}/api/auth/passkeys`);
    expect(respostaListar.status).toBe(401);

    const respostaOpcoes = await fetch(`${BASE_URL}/api/auth/passkeys/registro/opcoes`, {
      method: "POST",
    });
    expect(respostaOpcoes.status).toBe(401);

    const respostaConfirmar = await fetch(`${BASE_URL}/api/auth/passkeys/registro/confirmar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passkeyToken: "qualquer", resposta: {} }),
    });
    expect(respostaConfirmar.status).toBe(401);

    const respostaExcluir = await fetch(`${BASE_URL}/api/auth/passkeys/id-qualquer`, {
      method: "DELETE",
    });
    expect(respostaExcluir.status).toBe(401);
  });

  it("bloqueia registro sem o token CSRF", async () => {
    const usuario = await criarUsuarioTeste("passkey-sem-csrf");
    emailsCriados.push(usuario.email);
    const { cookies } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/passkeys/registro/opcoes`, {
      method: "POST",
      headers: { Cookie: `tokenAcesso=${cookies.tokenAcesso}; csrfToken=${cookies.csrfToken}` },
    });
    expect(resposta.status).toBe(403);
  });

  it("gera opções de registro coerentes (usuário, challenge, sem credenciais pra excluir)", async () => {
    const usuario = await criarUsuarioTeste("passkey-opcoes-registro");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/passkeys/registro/opcoes`, {
      method: "POST",
      headers: cabecalhos,
    });
    expect(resposta.status).toBe(200);

    const corpo = await resposta.json();
    expect(corpo.passkeyToken).toBeTruthy();
    expect(corpo.options.challenge).toBeTruthy();
    expect(corpo.options.user.name).toBe(usuario.email);
    expect(corpo.options.excludeCredentials).toEqual([]);
    expect(corpo.options.authenticatorSelection.residentKey).toBe("required");
  });

  it("gera opções de login público (sem autenticação, sem allowCredentials)", async () => {
    const resposta = await fetch(`${BASE_URL}/api/auth/passkeys/login/opcoes`, { method: "POST" });
    expect(resposta.status).toBe(200);

    const corpo = await resposta.json();
    expect(corpo.passkeyToken).toBeTruthy();
    expect(corpo.options.challenge).toBeTruthy();
    expect(corpo.options.allowCredentials ?? []).toEqual([]);
  });

  it("rejeita confirmação de registro com resposta forjada/malformada", async () => {
    const usuario = await criarUsuarioTeste("passkey-registro-forjado");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);
    const usuarioRegistro = await prisma.usuario.findUniqueOrThrow({ where: { email: usuario.email } });

    const respostaOpcoes = await fetch(`${BASE_URL}/api/auth/passkeys/registro/opcoes`, {
      method: "POST",
      headers: cabecalhos,
    });
    const { passkeyToken } = await respostaOpcoes.json();

    const respostaConfirmar = await fetch(`${BASE_URL}/api/auth/passkeys/registro/confirmar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ passkeyToken, resposta: { id: "forjado", nao: "e-uma-attestation-de-verdade" } }),
    });
    expect(respostaConfirmar.status).toBe(400);

    const passkeys = await prisma.passkeyCredencial.findMany({ where: { usuarioId: usuarioRegistro.id } });
    expect(passkeys).toHaveLength(0);
  });

  it("não deixa confirmar um registro com o passkeyToken de outra conta", async () => {
    const dono = await criarUsuarioTeste("passkey-token-dono");
    const outro = await criarUsuarioTeste("passkey-token-outro");
    emailsCriados.push(dono.email, outro.email);
    const { cabecalhos: cabecalhosDono } = await loginTeste(dono.email, dono.senha);
    const { cabecalhos: cabecalhosOutro } = await loginTeste(outro.email, outro.senha);

    const respostaOpcoes = await fetch(`${BASE_URL}/api/auth/passkeys/registro/opcoes`, {
      method: "POST",
      headers: cabecalhosDono,
    });
    const { passkeyToken } = await respostaOpcoes.json();

    const respostaConfirmar = await fetch(`${BASE_URL}/api/auth/passkeys/registro/confirmar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhosOutro },
      body: JSON.stringify({ passkeyToken, resposta: { id: "x" } }),
    });
    expect(respostaConfirmar.status).toBe(401);
  });

  it("rejeita login com uma credencial desconhecida", async () => {
    const respostaOpcoes = await fetch(`${BASE_URL}/api/auth/passkeys/login/opcoes`, { method: "POST" });
    const { passkeyToken } = await respostaOpcoes.json();

    const respostaConfirmar = await fetch(`${BASE_URL}/api/auth/passkeys/login/confirmar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passkeyToken, resposta: { id: "credencial-que-nao-existe" } }),
    });
    expect(respostaConfirmar.status).toBe(401);
  });

  it("lista, não vaza segredos e respeita posse (ownership) na exclusão", async () => {
    const dono = await criarUsuarioTeste("passkey-crud-dono");
    const outro = await criarUsuarioTeste("passkey-crud-outro");
    emailsCriados.push(dono.email, outro.email);
    const { cabecalhos: cabecalhosDono } = await loginTeste(dono.email, dono.senha);
    const { cabecalhos: cabecalhosOutro } = await loginTeste(outro.email, outro.senha);

    const donoRegistro = await prisma.usuario.findUniqueOrThrow({ where: { email: dono.email } });

    // Fabricado direto no banco (bypassando a ceremônia WebAuthn de verdade,
    // que só é exercitável com browser) — suficiente pra testar list/delete.
    const passkey = await prisma.passkeyCredencial.create({
      data: {
        usuarioId: donoRegistro.id,
        credentialId: `cred-teste-${Date.now()}`,
        publicKey: Buffer.from("chave-publica-fake").toString("base64"),
        contador: 0,
        transportes: ["internal"],
        nome: "Passkey de teste",
      },
    });

    const respostaListar = await fetch(`${BASE_URL}/api/auth/passkeys`, { headers: cabecalhosDono });
    const corpoListar = await respostaListar.json();
    const linha = corpoListar.passkeys.find((p: { id: string }) => p.id === passkey.id);
    expect(linha).toBeTruthy();
    expect(linha.nome).toBe("Passkey de teste");
    expect(linha).not.toHaveProperty("publicKey");
    expect(linha).not.toHaveProperty("credentialId");
    expect(linha).not.toHaveProperty("contador");

    // Outra conta não pode excluir a passkey do dono.
    const respostaExcluirOutro = await fetch(`${BASE_URL}/api/auth/passkeys/${passkey.id}`, {
      method: "DELETE",
      headers: cabecalhosOutro,
    });
    expect(respostaExcluirOutro.status).toBe(404);
    expect(await prisma.passkeyCredencial.findUnique({ where: { id: passkey.id } })).not.toBeNull();

    // O dono consegue.
    const respostaExcluirDono = await fetch(`${BASE_URL}/api/auth/passkeys/${passkey.id}`, {
      method: "DELETE",
      headers: cabecalhosDono,
    });
    expect(respostaExcluirDono.status).toBe(200);
    expect(await prisma.passkeyCredencial.findUnique({ where: { id: passkey.id } })).toBeNull();
  });
});
