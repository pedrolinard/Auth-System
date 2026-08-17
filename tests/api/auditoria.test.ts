import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { apagarUsuariosTeste, BASE_URL, criarUsuarioTeste, loginTeste } from "../helpers";

const emailsCriados: string[] = [];

async function promoverAdmin(email: string) {
  await prisma.usuario.update({ where: { email }, data: { papel: "admin" } });
}

describe("Painel de auditoria (admin)", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("usuário comum recebe 403", async () => {
    const usuario = await criarUsuarioTeste("auditoria-403");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/auditoria`, { headers: cabecalhos });
    expect(resposta.status).toBe(403);
  });

  it("sem autenticação recebe 401", async () => {
    const resposta = await fetch(`${BASE_URL}/api/auth/auditoria`);
    expect(resposta.status).toBe(401);
  });

  it("admin lista os registros mais recentes, filtrando por evento e e-mail", async () => {
    const admin = await criarUsuarioTeste("auditoria-admin");
    const alvo = await criarUsuarioTeste("auditoria-alvo");
    emailsCriados.push(admin.email, alvo.email);
    await promoverAdmin(admin.email);
    const { cabecalhos } = await loginTeste(admin.email, admin.senha);

    // Gera um evento "login_falha" reconhecível pro alvo.
    await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: alvo.email, senha: "SenhaErrada999!" }),
    });

    const respostaGeral = await fetch(`${BASE_URL}/api/auth/auditoria`, { headers: cabecalhos });
    expect(respostaGeral.status).toBe(200);
    const corpoGeral = await respostaGeral.json();
    expect(Array.isArray(corpoGeral.registros)).toBe(true);
    expect(corpoGeral.registros.length).toBeGreaterThan(0);

    const respostaFiltrada = await fetch(
      `${BASE_URL}/api/auth/auditoria?evento=login_falha&email=${encodeURIComponent(alvo.email)}`,
      { headers: cabecalhos },
    );
    expect(respostaFiltrada.status).toBe(200);
    const corpoFiltrado = await respostaFiltrada.json();
    expect(corpoFiltrado.registros.length).toBeGreaterThan(0);
    for (const registro of corpoFiltrado.registros) {
      expect(registro.evento).toBe("login_falha");
      expect(registro.email).toBe(alvo.email);
    }
  });
});
