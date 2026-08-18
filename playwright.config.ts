import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { config as carregarEnv } from "dotenv";

// Mesma database dedicada dos testes de API (Vitest) — os dois tipos de
// teste nunca rodam ao mesmo tempo no fluxo normal (`npm test` x
// `npm run test:e2e`), então compartilhar a `autenticacao_test` não gera
// conflito e evita manter uma terceira database só pra isso.
const { parsed: envRaiz } = carregarEnv({ path: path.resolve(__dirname, ".env") });
const DATABASE_URL_TESTE = "postgresql://postgres:postgres@localhost:5432/autenticacao_test";

// Os arquivos de teste importam @/lib/db diretamente (helpers de limpeza) —
// sem isso, o processo do Playwright herdaria o DATABASE_URL de dev do
// ambiente, mesmo problema resolvido em vitest.config.ts pro Vitest.
process.env.DATABASE_URL = DATABASE_URL_TESTE;

// Porta própria (3200), diferente da 3100 usada pelo Vitest — permite rodar
// os dois tipos de teste em paralelo sem os servidores `next dev` colidirem.
const PORTA_E2E = 3200;
const BASE_URL = `http://localhost:${PORTA_E2E}`;

export default defineConfig({
  testDir: "./tests-e2e",
  globalSetup: "./tests-e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  // 10s (não os 5s default): /api/auth/cadastro e as rotas de troca de senha
  // fazem uma chamada de rede real pro Have I Been Pwned (src/lib/senhaVazada.ts,
  // até 5s de timeout próprio) além do primeiro-hit de compilação do
  // Turbopack — mesmo raciocínio do testTimeout mais largo em
  // vitest.config.ts, aplicado aqui às assertions (`toHaveURL`, `toBeVisible`).
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx next dev -p ${PORTA_E2E}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...envRaiz,
      DATABASE_URL: DATABASE_URL_TESTE,
      VITEST_NEXT_DIST_DIR: ".next-e2e",
      // .env fixa PASSKEY_ORIGIN pro `next dev` manual (porta 3000) — sem
      // sobrescrever aqui, toda cerimônia WebAuthn de verdade feita pelo
      // browser do Playwright (porta 3200) seria rejeitada por origem
      // incompatível (verifyRegistrationResponse/verifyAuthenticationResponse
      // comparam a origem exata que o browser reportou).
      PASSKEY_ORIGIN: BASE_URL,
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
