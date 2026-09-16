import { expect, test, type Page } from "@playwright/test";
import {
  apagarUsuarioTeste,
  gerarEmailTeste,
  ipAleatorio,
  marcarEmailVerificado,
  SENHA_TESTE,
} from "./helpers";

async function cadastrar(page: Page, nome: string, email: string) {
  const resposta = await page.request.post("/api/auth/cadastro", {
    data: { nome, email, senha: SENHA_TESTE },
  });
  expect(resposta.status()).toBe(201);
}

async function entrar(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(SENHA_TESTE);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe("Convites recebidos (UI)", () => {
  test("convite para quem já tem conta aparece no painel dela e pode ser aceito ali", async ({ page }) => {
    const emailDona = gerarEmailTeste("convite-ui-dona");
    const emailConvidada = gerarEmailTeste("convite-ui-convidada");
    await page.context().setExtraHTTPHeaders({ "X-Forwarded-For": ipAleatorio() });

    try {
      await cadastrar(page, "Dona E2E", emailDona);
      await cadastrar(page, "Convidada E2E", emailConvidada);
      await marcarEmailVerificado(emailConvidada);

      // A dona convida pela tela de organizações.
      await entrar(page, emailDona);
      await page.goto("/dashboard/organizacoes");
      await page.getByPlaceholder("E-mail da pessoa").fill(emailConvidada);
      await page.getByRole("button", { name: "Enviar convite" }).click();
      await expect(page.getByText(emailConvidada, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Sair", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);

      // A convidada vê o convite no painel, sem precisar do link do e-mail.
      await entrar(page, emailConvidada);
      await page.goto("/dashboard/organizacoes");
      await expect(page.getByRole("heading", { name: "Convites recebidos" })).toBeVisible();
      await expect(page.getByText("Dona E2E convidou você como membro")).toBeVisible();

      await page.getByRole("button", { name: /^Aceitar convite de / }).click();

      // Recarrega já dentro da organização aceita: a seção some e a
      // organização da dona aparece como ativa.
      await expect(page.getByRole("heading", { name: "Convites recebidos" })).toHaveCount(0);
      const ativa = page.locator("li", { hasText: "Ativa" });
      await expect(ativa).toHaveCount(1);
      await expect(ativa).not.toContainText("Convidada E2E");
    } finally {
      await apagarUsuarioTeste(emailConvidada);
      await apagarUsuarioTeste(emailDona);
    }
  });
});
