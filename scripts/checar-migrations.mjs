// Portão de migrations do build. NÃO aplica nada — só verifica.
//
// Por que isto existe: o `build` rodava `prisma migrate deploy`, e como os
// ambientes Preview e Production da Vercel compartilham a mesma instância
// Supabase, QUALQUER build de preview aplicava migrations no banco de
// PRODUÇÃO. Em 2026-09-08 um pull request fez exatamente isso: o build de
// preview falhou depois (por uma env var que só existe em Production), mas as
// migrations já tinham passado, e produção ficou com schema novo e código
// velho — o cadastro caiu com violação de NOT NULL até o merge sair.
//
// Agravante que tornava isso invisível: `migrate deploy` roda ANTES do
// `next build`, então até um build que falha já mexeu no banco.
//
// A troca: aplicar migration deixa de ser efeito colateral de um build e vira
// passo deliberado (`npx prisma migrate deploy` com o DATABASE_URL certo),
// igual ao lado Django, que sempre foi assim. Este script só garante que
// ninguém suba código de produção esperando um schema que ainda não existe.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { config as carregarEnv } from "dotenv";

// Na Vercel o DATABASE_URL vem do ambiente. Localmente ele vive em arquivo, e
// sem carregar aqui a checagem se pularia sozinha em toda máquina de dev —
// falhar aberto é justamente o padrão que produziu o incidente que este script
// existe pra impedir. A ordem imita a do Next (.env.local por cima do .env):
// o dotenv não sobrescreve o que já está definido, então quem carrega primeiro
// ganha.
const RAIZ = path.resolve(import.meta.dirname, "..");
carregarEnv({ path: path.join(RAIZ, ".env.local"), quiet: true });
carregarEnv({ path: path.join(RAIZ, ".env"), quiet: true });

const AMBIENTE = process.env.VERCEL_ENV ?? "local";

function comandoDeCorrecao() {
  return [
    "  1. aplique as migrations no banco correspondente:",
    "       npx prisma migrate deploy       # com o DATABASE_URL do ambiente",
    "  2. rode o deploy de novo",
    "",
    "  Numa mudança de schema, a ordem é sempre: migration -> backfill (se houver) -> código.",
  ].join("\n");
}

if (!process.env.DATABASE_URL) {
  // Em produção isso é erro, não motivo pra pular: um build de produção sem
  // banco configurado está quebrado de qualquer jeito, e deixar a checagem
  // "passar" por ausência de configuração seria falhar ABERTO — exatamente o
  // que transformou um preview em incidente de produção.
  if (AMBIENTE === "production") {
    console.error("[migrations] BUILD INTERROMPIDO — DATABASE_URL não definida no ambiente de produção.");
    process.exit(1);
  }
  console.warn("[migrations] DATABASE_URL não definida — checagem pulada (ambiente: " + AMBIENTE + ").");
  process.exit(0);
}

let saida = "";
let pendentes = false;
try {
  saida = execFileSync("npx", ["prisma", "migrate", "status"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
} catch (erro) {
  // `migrate status` sai com código != 0 quando há migration pendente OU
  // falhada. Os dois casos significam a mesma coisa aqui: o banco não está no
  // estado que este código espera.
  pendentes = true;
  saida = `${erro.stdout ?? ""}${erro.stderr ?? ""}`;
}

if (!pendentes) {
  console.log(`[migrations] Banco em dia (${AMBIENTE}).`);
  process.exit(0);
}

const detalhe = saida
  .split("\n")
  .filter((linha) => linha.trim() && !linha.startsWith("Loaded Prisma config"))
  .slice(-12)
  .join("\n");

if (AMBIENTE === "production") {
  console.error("");
  console.error("[migrations] BUILD INTERROMPIDO — há migrations não aplicadas no banco de produção.");
  console.error("");
  console.error(detalhe);
  console.error("");
  console.error("Este build NÃO aplica migrations (de propósito: era isso que deixava um");
  console.error("deploy de preview escrever no banco de produção). Para seguir:");
  console.error("");
  console.error(comandoDeCorrecao());
  console.error("");
  process.exit(1);
}

// Preview e local: avisa alto, mas não bloqueia. Numa branch com migration
// nova o preview vai mesmo rodar contra um schema mais antigo — e ver o
// preview quebrado é infinitamente melhor do que ele consertar o schema
// sozinho, no banco de produção.
console.warn("");
console.warn(`[migrations] AVISO (${AMBIENTE}): há migrations não aplicadas no banco apontado por DATABASE_URL.`);
console.warn("Este ambiente vai rodar contra um schema mais antigo que o código.");
console.warn("");
console.warn(detalhe);
console.warn("");
process.exit(0);
