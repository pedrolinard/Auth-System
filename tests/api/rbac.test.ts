import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { apagarUsuariosTeste, BASE_URL, criarUsuarioTeste, loginTeste } from "../helpers";

const emailsCriados: string[] = [];

describe("RBAC — GET /api/auth/usuarios", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("dono da própria organização (padrão do cadastro) recebe 200", async () => {
    // Todo cadastro já cria o usuário como "dono" da organização pessoal
    // (ver src/lib/organizacao.ts) — não precisa de nenhuma promoção.
    const usuario = await criarUsuarioTeste("rbac-dono");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/usuarios`, { headers: cabecalhos });
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(Array.isArray(corpo.usuarios)).toBe(true);
    expect(corpo.usuarios.some((u: { email: string }) => u.email === usuario.email)).toBe(true);
  });

  it("membro comum (rebaixado da organização) recebe 403", async () => {
    const usuario = await criarUsuarioTeste("rbac-membro");
    emailsCriados.push(usuario.email);
    const registro = await prisma.usuario.findUniqueOrThrow({ where: { email: usuario.email } });
    const membro = await prisma.membro.findFirstOrThrow({ where: { usuarioId: registro.id } });
    await prisma.membro.update({ where: { id: membro.id }, data: { papel: "membro" } });

    // O papel de organização vai como claim no token de acesso — precisa
    // logar de novo depois de mudar o Membro pra pegar um token atualizado.
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/usuarios`, { headers: cabecalhos });
    expect(resposta.status).toBe(403);
  });

  it("Usuario.papel = admin (papel de SISTEMA) sozinho não dá acesso — não é mais o que importa aqui", async () => {
    // Regressão: antes do multi-tenant, esse era o único jeito de virar
    // admin dessa rota. Agora quem decide é o papel NA ORGANIZAÇÃO
    // (Membro.papel) — o papel de sistema (Usuario.papel) continua existindo
    // (ver token.ts), mas essa rota não olha mais pra ele.
    const usuario = await criarUsuarioTeste("rbac-papel-sistema");
    emailsCriados.push(usuario.email);
    const registro = await prisma.usuario.findUniqueOrThrow({ where: { email: usuario.email } });
    const membro = await prisma.membro.findFirstOrThrow({ where: { usuarioId: registro.id } });
    await prisma.membro.update({ where: { id: membro.id }, data: { papel: "membro" } });
    await prisma.usuario.update({ where: { id: registro.id }, data: { papel: "admin" } });

    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/usuarios`, { headers: cabecalhos });
    expect(resposta.status).toBe(403);
  });

  it("sem autenticação recebe 401", async () => {
    const resposta = await fetch(`${BASE_URL}/api/auth/usuarios`);
    expect(resposta.status).toBe(401);
  });
});
