import { expect, test } from "@playwright/test";
import { apagarUsuarioTeste, gerarEmailTeste, ipAleatorio, SENHA_TESTE } from "./helpers";

// Ceremônia WebAuthn de verdade (assinatura criptográfica real) só é
// exercitável com um authenticator de verdade OU um "virtual authenticator"
// via Chrome DevTools Protocol — não dá pra simular no Vitest (que bate só
// nas rotas de API, sem browser). Este é o único lugar da suíte que cobre o
// fluxo de passkey ponta a ponta (registrar -> logout -> logar sem senha).
test.describe("Passkeys (WebAuthn) — fluxo completo via virtual authenticator", () => {
  test("registra uma passkey no dashboard e loga com ela, sem senha", async ({ page }) => {
    const email = gerarEmailTeste("passkey");

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    await page.context().setExtraHTTPHeaders({ "X-Forwarded-For": ipAleatorio() });
    await page.goto("/cadastro");
    await page.getByLabel("Nome").fill("Usuária Passkey E2E");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(SENHA_TESTE);
    await page.getByRole("button", { name: "Cadastrar" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(SENHA_TESTE);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByPlaceholder("ex.: Touch ID do MacBook").fill("Passkey de teste");
    await page.getByRole("button", { name: "Adicionar passkey" }).click();
    await expect(page.getByText("Passkey de teste")).toBeVisible();

    await page.getByRole("button", { name: "Sair", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByRole("button", { name: "Entrar com uma passkey" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    await apagarUsuarioTeste(email);
  });
});
