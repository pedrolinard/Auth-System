import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { gerarTokenVerificacaoEmail } from "@/lib/token";
import { apagarUsuariosTeste, BASE_URL, criarUsuarioTeste, loginTeste } from "../helpers";

const emailsCriados: string[] = [];

describe("POST /api/auth/verificar-email", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("token válido marca emailVerificado", async () => {
    const usuario = await criarUsuarioTeste("verificar-email-ok");
    emailsCriados.push(usuario.email);
    const registro = await prisma.usuario.findUniqueOrThrow({
      where: { email: usuario.email },
    });
    const token = await gerarTokenVerificacaoEmail(registro.id);

    const resposta = await fetch(`${BASE_URL}/api/auth/verificar-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(resposta.status).toBe(200);

    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);
    const respostaMe = await fetch(`${BASE_URL}/api/auth/me`, { headers: cabecalhos });
    const corpoMe = await respostaMe.json();
    expect(corpoMe.usuario.emailVerificado).toBe(true);
  });

  it("rejeita token inválido/adulterado com 401", async () => {
    const resposta = await fetch(`${BASE_URL}/api/auth/verificar-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "token-que-nao-existe" }),
    });
    expect(resposta.status).toBe(401);
  });
});
