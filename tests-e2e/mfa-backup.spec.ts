import { expect, test } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { apagarUsuarioTeste, gerarEmailTeste, ipAleatorio, SENHA_TESTE } from "./helpers";

// Regressão: a API de login com código de backup (/api/auth/mfa/backup)
// existia, mas nenhuma tela a chamava — quem perdia o autenticador ficava
// trancado pra fora com 10 códigos que não serviam pra nada.
test.describe("MFA — login com código de backup (UI)", () => {
  test("quem perdeu o autenticador entra com um código de backup", async ({ page }) => {
    const email = gerarEmailTeste("mfa-backup");
    await page.context().setExtraHTTPHeaders({ "X-Forwarded-For": ipAleatorio() });

    // Monta a conta com MFA ativo pela API — o que se testa aqui é a tela de
    // login, não a ativação (coberta em tests/api/mfa.test.ts).
    const api = page.context().request;
    await api.post("/api/auth/cadastro", { data: { nome: "Usuária Backup E2E", email, senha: SENHA_TESTE } });
    await api.post("/api/auth/login", { data: { email, senha: SENHA_TESTE } });
    const csrf = (await page.context().cookies()).find((c) => c.name === "csrfToken")?.value ?? "";

    const iniciar = await api.post("/api/auth/mfa/iniciar", { headers: { "X-CSRF-Token": csrf } });
    const { segredo } = await iniciar.json();
    const codigoTotp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(segredo),
    }).generate();
    const confirmar = await api.post("/api/auth/mfa/confirmar", {
      headers: { "X-CSRF-Token": csrf },
      data: { codigo: codigoTotp },
    });
    const { codigosBackup } = await confirmar.json();
    expect(codigosBackup).toHaveLength(10);

    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(SENHA_TESTE);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Só falta o código" })).toBeVisible();
    await page.getByRole("button", { name: "Perdi o autenticador — usar um código de backup" }).click();
    await page.getByLabel("Código de backup").fill(codigosBackup[0]);
    await page.getByRole("button", { name: "Verificar" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);

    await apagarUsuarioTeste(email);
  });
});
