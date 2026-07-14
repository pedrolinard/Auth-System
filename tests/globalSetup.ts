import { spawn, execSync } from "node:child_process";
import path from "node:path";
import { config as carregarEnv } from "dotenv";

const RAIZ = path.resolve(__dirname, "..");
const PORTA_TESTE = 3100;
const DATABASE_URL_TESTE =
  "postgresql://postgres:postgres@localhost:5432/autenticacao_test";

export default async function setup() {
  // Carrega os segredos JWT/etc. do .env real da raiz; só o DATABASE_URL é
  // sobrescrito pra database de teste dedicada (isolada do banco de dev).
  carregarEnv({ path: path.join(RAIZ, ".env") });

  const envServidor: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: DATABASE_URL_TESTE,
    VITEST_NEXT_DIST_DIR: ".next-test",
  };

  console.log("[tests] Aplicando migrations na autenticacao_test...");
  execSync("npx prisma migrate deploy", {
    cwd: RAIZ,
    env: envServidor,
    stdio: "inherit",
  });

  console.log(`[tests] Subindo Next.js de teste na porta ${PORTA_TESTE}...`);
  const servidor = spawn(`npx next dev -p ${PORTA_TESTE}`, {
    cwd: RAIZ,
    env: envServidor,
    shell: true,
  });

  servidor.stdout?.on("data", () => {});
  servidor.stderr?.on("data", (dado: Buffer) => {
    const texto = dado.toString();
    if (texto.toLowerCase().includes("error")) console.error("[next-teste]", texto);
  });

  await esperarServidorPronto(`http://localhost:${PORTA_TESTE}`);
  console.log("[tests] Servidor de teste pronto.");

  return async () => {
    if (!servidor.pid) return;
    console.log("[tests] Encerrando servidor de teste...");
    try {
      // taskkill /t mata a árvore inteira do processo (next dev sobe vários
      // node.exe filhos no Windows — matar só o PID raiz deixa órfãos).
      execSync(`taskkill /pid ${servidor.pid} /t /f`, { stdio: "ignore" });
    } catch {
      // processo já pode ter encerrado sozinho
    }
  };
}

async function esperarServidorPronto(url: string, tentativas = 60) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const resposta = await fetch(url);
      if (resposta.status < 500) return;
    } catch {
      // servidor ainda não subiu, tenta de novo
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Servidor de teste não respondeu em ${url} a tempo.`);
}
