import path from "node:path";
import { config as carregarEnv } from "dotenv";
import { defineConfig } from "vitest/config";

// Carrega os segredos JWT/etc. do .env real da raiz — os arquivos de teste
// importam funções de src/lib/token.ts diretamente (ex.: pra gerar um token
// de redefinição de senha sem depender de capturar o console.log do
// servidor spawnado), então precisam dos mesmos segredos que ele usa.
const { parsed: envRaiz } = carregarEnv({ path: path.resolve(__dirname, ".env") });

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["tests/globalSetup.ts"],
    // 30s (não 20s): algumas rotas só compilam no primeiro hit do Turbopack,
    // e qual teste bate nelas primeiro varia por execução (arquivos rodam em
    // paralelo) — um valor baixo demais causa timeouts esporádicos que não
    // são um bug real, só a rota ainda não compilada.
    testTimeout: 30000,
    hookTimeout: 60000,
    // O próprio processo do Vitest também precisa apontar pra database de
    // teste, já que os arquivos de teste importam @/lib/db diretamente para
    // setup/limpeza (ex.: apagar usuários criados no teste).
    env: {
      ...envRaiz,
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/autenticacao_test",
    },
  },
});
