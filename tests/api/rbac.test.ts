import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { apagarUsuariosTeste, BASE_URL, criarUsuarioTeste, loginTeste } from "../helpers";

const emailsCriados: string[] = [];

describe("RBAC — GET /api/auth/usuarios", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("usuário comum recebe 403", async () => {
    const usuario = await criarUsuarioTeste("rbac-comum");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/usuarios`, { headers: cabecalhos });
    expect(resposta.status).toBe(403);
  });

  it("admin recebe 200 com a lista de usuários", async () => {
    const usuario = await criarUsuarioTeste("rbac-admin");
    emailsCriados.push(usuario.email);

    await prisma.usuario.update({
      where: { email: usuario.email },
      data: { papel: "admin" },
    });

    // O papel vai como claim no token de acesso — precisa logar de novo
    // depois de promover a admin pra pegar um token com o claim atualizado.
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/usuarios`, { headers: cabecalhos });
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(Array.isArray(corpo.usuarios)).toBe(true);
    expect(corpo.usuarios.some((u: { email: string }) => u.email === usuario.email)).toBe(
      true,
    );
  });

  it("sem autenticação recebe 401", async () => {
    const resposta = await fetch(`${BASE_URL}/api/auth/usuarios`);
    expect(resposta.status).toBe(401);
  });
});
