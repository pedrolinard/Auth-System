import * as OTPAuth from "otpauth";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { apagarUsuariosTeste, BASE_URL, criarUsuarioTeste, loginTeste } from "../helpers";

const emailsCriados: string[] = [];

async function promoverAdmin(email: string) {
  await prisma.usuario.update({ where: { email }, data: { papel: "admin" } });
}

describe("Admin — suspender/reativar/excluir usuário", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("usuário comum recebe 403 ao tentar suspender outro usuário", async () => {
    const admin = await criarUsuarioTeste("admin-susp-403");
    const alvo = await criarUsuarioTeste("alvo-susp-403");
    emailsCriados.push(admin.email, alvo.email);
    const { cabecalhos } = await loginTeste(admin.email, admin.senha);
    const alvoRegistro = await prisma.usuario.findUniqueOrThrow({ where: { email: alvo.email } });

    const resposta = await fetch(`${BASE_URL}/api/auth/usuarios/${alvoRegistro.id}/suspender`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({}),
    });
    expect(resposta.status).toBe(403);
  });

  it("admin suspende temporariamente e o login passa a ser bloqueado", async () => {
    const admin = await criarUsuarioTeste("admin-susp-temp");
    const alvo = await criarUsuarioTeste("alvo-susp-temp");
    emailsCriados.push(admin.email, alvo.email);
    await promoverAdmin(admin.email);
    const { cabecalhos } = await loginTeste(admin.email, admin.senha);
    const alvoRegistro = await prisma.usuario.findUniqueOrThrow({ where: { email: alvo.email } });

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

  it("admin suspende permanentemente (sem dias) e reativa depois", async () => {
    const admin = await criarUsuarioTeste("admin-susp-perm");
    const alvo = await criarUsuarioTeste("alvo-susp-perm");
    emailsCriados.push(admin.email, alvo.email);
    await promoverAdmin(admin.email);
    const { cabecalhos } = await loginTeste(admin.email, admin.senha);
    const alvoRegistro = await prisma.usuario.findUniqueOrThrow({ where: { email: alvo.email } });

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

  it("suspender revoga as sessões ativas na hora", async () => {
    const admin = await criarUsuarioTeste("admin-susp-sessao");
    const alvo = await criarUsuarioTeste("alvo-susp-sessao");
    emailsCriados.push(admin.email, alvo.email);
    await promoverAdmin(admin.email);
    const { cabecalhos } = await loginTeste(admin.email, admin.senha);
    const sessaoAlvo = await loginTeste(alvo.email, alvo.senha);
    const alvoRegistro = await prisma.usuario.findUniqueOrThrow({ where: { email: alvo.email } });

    await fetch(`${BASE_URL}/api/auth/usuarios/${alvoRegistro.id}/suspender`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: JSON.stringify({ dias: 1 }),
    });

    const respostaAtualizar = await fetch(`${BASE_URL}/api/auth/atualizar`, {
      method: "POST",
      headers: sessaoAlvo.cabecalhos,
    });
    expect(respostaAtualizar.status).toBe(401);
  });

  it("admin não consegue suspender nem excluir a própria conta", async () => {
    const admin = await criarUsuarioTeste("admin-auto-susp");
    emailsCriados.push(admin.email);
    await promoverAdmin(admin.email);
    const { cabecalhos } = await loginTeste(admin.email, admin.senha);
    const adminRegistro = await prisma.usuario.findUniqueOrThrow({ where: { email: admin.email } });

    const respostaSuspender = await fetch(
      `${BASE_URL}/api/auth/usuarios/${adminRegistro.id}/suspender`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecalhos },
        body: JSON.stringify({}),
      },
    );
    expect(respostaSuspender.status).toBe(400);

    const respostaExcluir = await fetch(`${BASE_URL}/api/auth/usuarios/${adminRegistro.id}`, {
      method: "DELETE",
      headers: cabecalhos,
    });
    expect(respostaExcluir.status).toBe(400);
  });

  it("suspender no meio do desafio de MFA bloqueia a conclusão do login", async () => {
    const admin = await criarUsuarioTeste("admin-susp-mfa");
    const alvo = await criarUsuarioTeste("alvo-susp-mfa");
    emailsCriados.push(admin.email, alvo.email);
    await promoverAdmin(admin.email);
    const { cabecalhos: cabecalhosAdmin } = await loginTeste(admin.email, admin.senha);
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

    // Admin suspende a conta ANTES do código de MFA ser enviado.
    const alvoRegistro = await prisma.usuario.findUniqueOrThrow({ where: { email: alvo.email } });
    await fetch(`${BASE_URL}/api/auth/usuarios/${alvoRegistro.id}/suspender`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhosAdmin },
      body: JSON.stringify({}),
    });

    const respostaVerificar = await fetch(`${BASE_URL}/api/auth/mfa/verificar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mfaToken, codigo: totp.generate() }),
    });
    expect(respostaVerificar.status).toBe(403);
  });

  it("admin exclui a conta de outro usuário permanentemente", async () => {
    const admin = await criarUsuarioTeste("admin-excluir");
    const alvo = await criarUsuarioTeste("alvo-excluir");
    emailsCriados.push(admin.email, alvo.email);
    await promoverAdmin(admin.email);
    const { cabecalhos } = await loginTeste(admin.email, admin.senha);
    const alvoRegistro = await prisma.usuario.findUniqueOrThrow({ where: { email: alvo.email } });

    const respostaExcluir = await fetch(`${BASE_URL}/api/auth/usuarios/${alvoRegistro.id}`, {
      method: "DELETE",
      headers: cabecalhos,
    });
    expect(respostaExcluir.status).toBe(200);

    const registroApagado = await prisma.usuario.findUnique({ where: { id: alvoRegistro.id } });
    expect(registroApagado).toBeNull();

    const loginApagado = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: alvo.email, senha: alvo.senha }),
    });
    expect(loginApagado.status).toBe(401);
  });
});
