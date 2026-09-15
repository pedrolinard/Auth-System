import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { apagarUsuariosTeste, BASE_URL, criarUsuarioTeste, loginTeste } from "../helpers";

const emailsCriados: string[] = [];

// /roadmap é público, mas os números de uso de produção (contas, admins,
// sessões ativas) não são — só quem opera o provedor os vê.
describe("GET /roadmap — métricas de uso", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("visitante anônimo não vê as métricas de uso", async () => {
    const html = await (await fetch(`${BASE_URL}/roadmap`)).text();
    expect(html).toContain("Visível só para quem opera o provedor.");
    expect(html).not.toContain("usuários cadastrados");
  });

  it("usuário comum logado também não vê", async () => {
    const usuario = await criarUsuarioTeste("roadmap-comum");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const html = await (await fetch(`${BASE_URL}/roadmap`, { headers: cabecalhos })).text();
    expect(html).not.toContain("usuários cadastrados");
  });

  it("quem opera o provedor vê", async () => {
    const operador = await criarUsuarioTeste("roadmap-operador");
    emailsCriados.push(operador.email);
    await prisma.usuario.updateMany({ where: { email: operador.email }, data: { papel: "admin" } });
    const { cabecalhos } = await loginTeste(operador.email, operador.senha);

    const html = await (await fetch(`${BASE_URL}/roadmap`, { headers: cabecalhos })).text();
    expect(html).toContain("usuários cadastrados");
  });
});
