import { expect, test } from "@playwright/test";
import { apagarUsuarioTeste, gerarEmailTeste, ipAleatorio, SENHA_TESTE } from "./helpers";

test.describe("Cadastro e login (UI)", () => {
  test("cadastra, faz login e vê o próprio nome no dashboard", async ({ page }) => {
    const email = gerarEmailTeste("cadastro-login");

    await page.context().setExtraHTTPHeaders({ "X-Forwarded-For": ipAleatorio() });
    await page.goto("/cadastro");
    await page.getByLabel("Nome").fill("Usuária E2E");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(SENHA_TESTE);
    await page.getByRole("button", { name: "Cadastrar" }).click();

    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(SENHA_TESTE);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Olá, Usuária E2E" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByText("E-mail não verificado")).toBeVisible();

    await apagarUsuarioTeste(email);
  });

  test("rejeita login com senha errada e mantém a pessoa em /login", async ({ page }) => {
    const email = gerarEmailTeste("login-senha-errada");

    await page.context().setExtraHTTPHeaders({ "X-Forwarded-For": ipAleatorio() });
    await page.goto("/cadastro");
    await page.getByLabel("Nome").fill("Usuária E2E");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(SENHA_TESTE);
    await page.getByRole("button", { name: "Cadastrar" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill("SenhaErrada999!");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();

    await expect(page.getByText("E-mail ou senha inválidos.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    await apagarUsuarioTeste(email);
  });

  test("recusa senha conhecida em vazamentos direto no formulário de cadastro", async ({
    page,
  }) => {
    const email = gerarEmailTeste("cadastro-senha-vazada");

    await page.context().setExtraHTTPHeaders({ "X-Forwarded-For": ipAleatorio() });
    await page.goto("/cadastro");
    await page.getByLabel("Nome").fill("Usuária E2E");
    await page.getByLabel("E-mail").fill(email);
    // "Password1" está entre as senhas mais comuns em vazamentos reais.
    await page.getByLabel("Senha", { exact: true }).fill("Password1");
    await page.getByRole("button", { name: "Cadastrar" }).click();

    await expect(
      page.getByText("Essa senha apareceu em vazamentos de dados conhecidos. Escolha outra."),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/cadastro$/);

    await apagarUsuarioTeste(email);
  });
});
