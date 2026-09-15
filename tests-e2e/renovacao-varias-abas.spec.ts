import { expect, test } from "@playwright/test";
import { apagarUsuarioTeste, gerarEmailTeste, ipAleatorio, SENHA_TESTE } from "./helpers";

// O servidor só deixa uma renovação por refresh token vencer. Abas do mesmo
// navegador compartilham o cookie e o access token delas expira junto — sem a
// coordenação entre abas em tentarAtualizarToken (src/lib/clienteAuth.ts), a
// aba que perde a corrida recebia 401 e agia como deslogada com uma sessão
// válida no cookie.
test.describe("Renovação de sessão com várias abas abertas", () => {
  test("duas abas com o access token expirado continuam logadas", async ({ context }) => {
    const email = gerarEmailTeste("varias-abas");
    await context.setExtraHTTPHeaders({ "X-Forwarded-For": ipAleatorio() });

    await context.request.post("/api/auth/cadastro", {
      data: { nome: "Usuária Abas E2E", email, senha: SENHA_TESTE },
    });
    const login = await context.request.post("/api/auth/login", { data: { email, senha: SENHA_TESTE } });
    expect(login.ok()).toBe(true);

    // Simula os 15 min do access token passando: some o cookie de acesso,
    // fica o de renovação — exatamente o estado das abas quando ele expira.
    await context.clearCookies({ name: "tokenAcesso" });

    const [aba1, aba2] = await Promise.all([context.newPage(), context.newPage()]);
    await Promise.all([aba1.goto("/dashboard"), aba2.goto("/dashboard")]);

    for (const aba of [aba1, aba2]) {
      await expect(aba.getByRole("heading", { name: "Olá, Usuária Abas E2E" })).toBeVisible();
      await expect(aba).toHaveURL(/\/dashboard$/);
    }

    await apagarUsuarioTeste(email);
  });
});
