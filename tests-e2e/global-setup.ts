import { execSync, spawn } from "node:child_process";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "..");
const PORTA_E2E = 3200;
const DATABASE_URL_TESTE =
  "postgresql://postgres:postgres@localhost:5432/autenticacao_test";

// Mesma database dedicada usada pelos testes de API (tests/globalSetup.ts) —
// garante o schema em dia antes do webServer do Playwright subir, sem
// depender de já ter rodado `npm test` antes.
export default async function globalSetup() {
  console.log("[e2e] Aplicando migrations na autenticacao_test...");
  execSync("npx prisma migrate deploy", {
    cwd: RAIZ,
    env: { ...process.env, DATABASE_URL: DATABASE_URL_TESTE },
    stdio: "inherit",
  });

  // Mesmo problema documentado em tests/globalSetup.ts: sob Turbopack, o
  // PRIMEIRO hit numa rota ainda não compilada pode falhar (em vez de só
  // demorar) quando o teste em si já está avançando — visto na prática como
  // /api/auth/login devolvendo a página de erro em HTML do Next em vez de
  // JSON. playwright.config.ts sobe seu PRÓPRIO `next dev` (reusa se já
  // tiver um na porta, criado aqui) depois deste globalSetup — subir um
  // servidor à parte só pra aquecer, e derrubar antes de sair, deixa o cache
  // de build do Turbopack em `.next-e2e` já quente pra quando o webServer
  // do Playwright (re)usar essa mesma porta/distDir.
  const envServidor: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: DATABASE_URL_TESTE,
    VITEST_NEXT_DIST_DIR: ".next-e2e",
    // Mesmo valor usado pelo webServer real do Playwright (playwright.config.ts)
    // — consistência, ainda que este servidor de aquecimento não faça
    // nenhuma cerimônia WebAuthn de verdade.
    PASSKEY_ORIGIN: `http://localhost:${PORTA_E2E}`,
  };

  console.log(`[e2e] Aquecendo rotas na porta ${PORTA_E2E}...`);
  // detached (fora do Windows) faz o processo virar líder do próprio grupo,
  // condição pra matar a árvore inteira com `kill(-pid)` no finally abaixo —
  // sem isso, mata só o shell (`shell: true`) e o `next dev`/node filhos
  // ficam órfãos segurando a porta 3200.
  const servidor = spawn(`npx next dev -p ${PORTA_E2E}`, {
    cwd: RAIZ,
    env: envServidor,
    shell: true,
    detached: process.platform !== "win32",
  });
  servidor.stdout?.on("data", () => {});
  servidor.stderr?.on("data", () => {});

  try {
    await esperarServidorPronto(`http://localhost:${PORTA_E2E}`);
    await aquecerRotas(`http://localhost:${PORTA_E2E}`);
    console.log("[e2e] Rotas pré-compiladas.");
  } finally {
    if (servidor.pid) {
      try {
        if (process.platform === "win32") {
          // taskkill /t mata a árvore inteira do processo (next dev sobe
          // vários node.exe filhos no Windows — matar só o PID raiz deixa
          // órfãos).
          execSync(`taskkill /pid ${servidor.pid} /t /f`, { stdio: "ignore" });
        } else {
          process.kill(-servidor.pid, "SIGKILL");
        }
      } catch {
        // processo já pode ter encerrado sozinho
      }
    }
  }
}

const ROTAS_PARA_AQUECER = [
  "/api/auth/atualizar",
  "/api/auth/cadastro",
  "/api/auth/esqueci-senha",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/auth/minha-conta",
  "/api/auth/mfa/confirmar",
  "/api/auth/mfa/desativar",
  "/api/auth/mfa/iniciar",
  "/api/auth/mfa/verificar",
  "/api/auth/passkeys",
  "/api/auth/passkeys/registro/opcoes",
  "/api/auth/passkeys/registro/confirmar",
  "/api/auth/passkeys/login/opcoes",
  "/api/auth/passkeys/login/confirmar",
  "/api/auth/redefinir-senha",
  "/api/auth/reenviar-verificacao",
  "/api/auth/senha",
  "/api/auth/sessoes",
  "/api/auth/usuarios",
  "/api/auth/verificar-email",
];

const PAGINAS_PARA_AQUECER = ["/cadastro", "/login", "/dashboard"];

async function aquecerRotas(baseUrl: string) {
  for (const rota of ROTAS_PARA_AQUECER) {
    try {
      await fetch(`${baseUrl}${rota}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } catch {
      // uma rota individual falhar em aquecer não deve travar a suíte — na
      // pior das hipóteses ela ainda compila sob demanda no teste real.
    }
  }
  for (const pagina of PAGINAS_PARA_AQUECER) {
    try {
      await fetch(`${baseUrl}${pagina}`);
    } catch {
      // idem — uma página não aquecida ainda compila sob demanda.
    }
  }
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
  throw new Error(`Servidor de aquecimento não respondeu em ${url} a tempo.`);
}
