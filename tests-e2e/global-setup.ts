import { execSync } from "node:child_process";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "..");
const DATABASE_URL_TESTE =
  "postgresql://postgres:postgres@localhost:5432/autenticacao_test";

// Mesma database dedicada usada pelos testes de API (tests/globalSetup.ts) —
// garante o schema em dia antes do webServer do Playwright subir, sem
// depender de já ter rodado `npm test` antes.
export default function globalSetup() {
  console.log("[e2e] Aplicando migrations na autenticacao_test...");
  execSync("npx prisma migrate deploy", {
    cwd: RAIZ,
    env: { ...process.env, DATABASE_URL: DATABASE_URL_TESTE },
    stdio: "inherit",
  });
}
