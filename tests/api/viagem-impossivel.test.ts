import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { apagarUsuariosTeste, BASE_URL, criarUsuarioTeste, ipAleatorio } from "../helpers";

const emailsCriados: string[] = [];

async function loginComGeo(
  email: string,
  senha: string,
  pais: string | undefined,
  ip: string = ipAleatorio(),
) {
  return fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": ip,
      ...(pais ? { "x-vercel-ip-country": pais } : {}),
    },
    body: JSON.stringify({ email, senha }),
  });
}

describe('Detecção de "viagem impossível"', () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("dois logins em países diferentes, pouco tempo depois, geram o alerta", async () => {
    const usuario = await criarUsuarioTeste("viagem-impossivel-detecta");
    emailsCriados.push(usuario.email);

    const primeiroLogin = await loginComGeo(usuario.email, usuario.senha, "BR");
    expect(primeiroLogin.status).toBe(200);

    const segundoLogin = await loginComGeo(usuario.email, usuario.senha, "US");
    expect(segundoLogin.status).toBe(200);

    const usuarioDb = await prisma.usuario.findUniqueOrThrow({ where: { email: usuario.email } });
    const log = await prisma.logAuditoria.findFirst({
      where: { usuarioId: usuarioDb.id, evento: "viagem_impossivel_detectada" },
    });
    expect(log).not.toBeNull();
  });

  it("dois logins do mesmo país não geram o alerta", async () => {
    const usuario = await criarUsuarioTeste("viagem-impossivel-mesmo-pais");
    emailsCriados.push(usuario.email);

    await loginComGeo(usuario.email, usuario.senha, "BR");
    await loginComGeo(usuario.email, usuario.senha, "BR");

    const usuarioDb = await prisma.usuario.findUniqueOrThrow({ where: { email: usuario.email } });
    const log = await prisma.logAuditoria.findFirst({
      where: { usuarioId: usuarioDb.id, evento: "viagem_impossivel_detectada" },
    });
    expect(log).toBeNull();
  });

  it("sem geo disponível (dev/fora da Vercel), não gera o alerta", async () => {
    const usuario = await criarUsuarioTeste("viagem-impossivel-sem-geo");
    emailsCriados.push(usuario.email);

    await loginComGeo(usuario.email, usuario.senha, undefined);
    await loginComGeo(usuario.email, usuario.senha, undefined);

    const usuarioDb = await prisma.usuario.findUniqueOrThrow({ where: { email: usuario.email } });
    const log = await prisma.logAuditoria.findFirst({
      where: { usuarioId: usuarioDb.id, evento: "viagem_impossivel_detectada" },
    });
    expect(log).toBeNull();
  });
});
