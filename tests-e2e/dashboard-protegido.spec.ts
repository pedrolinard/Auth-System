import { expect, test } from "@playwright/test";
import { apagarUsuarioTeste, gerarEmailTeste, ipAleatorio, SENHA_TESTE } from "./helpers";

test.describe("Dashboard protegido (UI)", () => {
  test("redireciona pra /login quando não autenticado", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("login → dashboard → sair → dashboard volta a redirecionar", async ({ page }) => {
    const email = gerarEmailTeste("logout");

    await page.context().setExtraHTTPHeaders({ "X-Forwarded-For": ipAleatorio() });
    await page.goto("/cadastro");
    await page.getByLabel("Nome").fill("Usuária E2E");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(SENHA_TESTE);
    await page.getByRole("button", { name: "Cadastrar" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(SENHA_TESTE);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("button", { name: "Sair", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);

    await apagarUsuarioTeste(email);
  });
});
