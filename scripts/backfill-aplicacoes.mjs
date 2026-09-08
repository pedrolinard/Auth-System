// Fase 00 do provedor: toda linha que existia antes de Aplicacao existir
// ganha uma aplicação — a "aplicação padrão", que é o próprio app de primeira
// parte deste projeto (o dashboard, as páginas de login, o serviço Django).
// Sem isso, a migration seguinte (aplicacoes_constraint), que torna
// aplicacaoId obrigatório, não teria como preencher as linhas existentes.
//
// Também importa o par de chaves RS256 que hoje vive em variável de ambiente
// pra dentro de chaves_assinatura, como primeira chave ativa. É o que permite
// o access token passar a carregar `kid` sem invalidar nada: a chave é a
// MESMA, só passa a ter nome e a ser publicável no JWKS.
//
// Idempotente em todos os passos: rodar de novo não duplica aplicação, não
// reatribui quem já tem aplicacaoId e não recria a chave (o kid é derivado do
// conteúdo da chave pública, então a mesma chave sempre gera o mesmo kid).
//
// node -r dotenv/config scripts/backfill-aplicacoes.mjs dotenv_config_path=.env

import { createCipheriv, createHash, randomBytes } from "node:crypto";
import pg from "pg";

// Mesma cópia intencional de src/lib/cripto.ts que rotacionar-chave-mfa.mjs
// já faz, e pelo mesmo motivo: não dá pra importar um módulo TS do app a
// partir de um script solto. Formato tem que bater byte a byte com o que o
// descriptografar() do app espera, senão a chave privada volta ilegível.
const ALGORITMO = "aes-256-gcm";
const TAMANHO_IV = 12;
const VERSAO_FORMATO_ATUAL = "v1";

function requerEnv(nome) {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`Defina a variável de ambiente ${nome} antes de rodar este script.`);
    process.exit(1);
  }
  return valor;
}

function decodificarChave(valor, nomeEnv) {
  const chave = Buffer.from(valor, "base64");
  if (chave.length !== 32) {
    console.error(`${nomeEnv} precisa ser 32 bytes em base64 (AES-256).`);
    process.exit(1);
  }
  return chave;
}

function cifrar(chaveAes, texto) {
  const iv = randomBytes(TAMANHO_IV);
  const cifra = createCipheriv(ALGORITMO, chaveAes, iv);
  const ciphertext = Buffer.concat([cifra.update(texto, "utf8"), cifra.final()]);
  const authTag = cifra.getAuthTag();
  return [VERSAO_FORMATO_ATUAL, iv, authTag, ciphertext]
    .map((parte) => (typeof parte === "string" ? parte : parte.toString("base64")))
    .join(":");
}

// Mesmo formato visual de id que o Prisma gera (cuid), pelo mesmo motivo
// documentado em backfill-organizacoes.mjs: linha criada por script não
// deveria destoar visualmente de linha criada pelo app.
function gerarId() {
  return `c${randomBytes(12).toString("hex").slice(0, 23)}`;
}

// O kid identifica a chave no JWKS e no header do JWT. Derivado do conteúdo
// da chave pública (não aleatório) de propósito: torna este script idempotente
// e torna o kid verificável — quem tem a chave pública consegue recalcular.
function derivarKid(publicaPem) {
  return createHash("sha256").update(publicaPem).digest("hex").slice(0, 16);
}

// A origem de onde o app de primeira parte fala. Em produção vem de
// PASSKEY_ORIGIN/BASE_URL; local, cai no dev server. Entra na allowlist de
// origens da aplicação padrão — é a mesma lista que o WebAuthn usa.
function origensDoAmbiente() {
  const origens = new Set();
  for (const nome of ["PASSKEY_ORIGIN", "BASE_URL"]) {
    const valor = process.env[nome];
    if (!valor) continue;
    try {
      origens.add(new URL(valor).origin);
    } catch {
      console.warn(`Ignorando ${nome}: "${valor}" não é uma URL válida.`);
    }
  }
  if (origens.size === 0) origens.add("http://localhost:3000");
  return [...origens];
}

async function garantirAplicacaoPadrao(client) {
  const { rows: existentes } = await client.query(
    'SELECT id, "clientId" FROM aplicacoes WHERE padrao = true LIMIT 1',
  );
  if (existentes.length > 0) {
    console.log(`Aplicação padrão já existe (${existentes[0].clientId}) — mantida.`);
    return existentes[0].id;
  }

  const id = gerarId();
  const origens = origensDoAmbiente();
  // O RP ID do WebAuthn é o HOST, sem esquema nem porta — um authenticator
  // recusa a credencial se não bater exatamente com o domínio da barra de
  // endereço. PASSKEY_RP_ID já guarda esse formato; sem ele, deriva da origem.
  const rpId = process.env.PASSKEY_RP_ID ?? new URL(origens[0]).hostname;

  await client.query(
    `INSERT INTO aplicacoes (id, nome, "clientId", origens, "passkeyRpId", ativa, padrao, "criadoEm", "atualizadoEm")
     VALUES ($1, $2, $3, $4, $5, true, true, now(), now())`,
    [id, "Aplicação padrão", `app_${randomBytes(16).toString("hex")}`, origens, rpId],
  );
  console.log(`Aplicação padrão criada — origens: ${origens.join(", ")} | rpId: ${rpId}`);
  return id;
}

// UPDATE em massa, não linha a linha: são colunas recém-criadas, todas nulas,
// sem nenhuma regra por linha pra aplicar (diferente do backfill de
// organizações, que gerava um slug único por usuário). O WHERE ... IS NULL é o
// que torna a operação idempotente.
async function atribuirAplicacao(client, tabela, aplicacaoId) {
  const { rowCount } = await client.query(
    `UPDATE ${tabela} SET "aplicacaoId" = $1 WHERE "aplicacaoId" IS NULL`,
    [aplicacaoId],
  );
  console.log(`${tabela}: ${rowCount} linha(s) atribuída(s) à aplicação padrão.`);
  return rowCount;
}

async function importarChaveDoAmbiente(client, chaveAes) {
  const publicaPem = Buffer.from(
    requerEnv("JWT_ACCESS_PUBLIC_KEY_B64"),
    "base64",
  ).toString("utf8");
  const privadaPem = Buffer.from(
    requerEnv("JWT_ACCESS_PRIVATE_KEY_B64"),
    "base64",
  ).toString("utf8");

  const kid = derivarKid(publicaPem);
  const { rows } = await client.query("SELECT id FROM chaves_assinatura WHERE kid = $1", [kid]);
  if (rows.length > 0) {
    console.log(`Chave de assinatura ${kid} já importada — mantida.`);
    return;
  }

  await client.query(
    `INSERT INTO chaves_assinatura (id, kid, "publicaPem", "privadaCifrada", ativa, "criadoEm")
     VALUES ($1, $2, $3, $4, true, now())`,
    [gerarId(), kid, publicaPem, cifrar(chaveAes, privadaPem)],
  );
  console.log(`Chave de assinatura ${kid} importada do ambiente e marcada como ativa.`);
}

async function principal() {
  const chaveAes = decodificarChave(requerEnv("MFA_ENCRYPTION_KEY"), "MFA_ENCRYPTION_KEY");
  const client = new pg.Client({ connectionString: requerEnv("DATABASE_URL") });
  await client.connect();

  try {
    // Tudo numa transação só: ao contrário do backfill de organizações (onde
    // cada usuário podia falhar sozinho por colisão de slug), aqui não existe
    // sucesso parcial que faça sentido — ou a aplicação padrão existe e todas
    // as linhas apontam pra ela, ou nada mudou.
    await client.query("BEGIN");

    const aplicacaoId = await garantirAplicacaoPadrao(client);
    await atribuirAplicacao(client, "usuarios", aplicacaoId);
    await atribuirAplicacao(client, "organizacoes", aplicacaoId);
    // logs_auditoria ganha só a aplicação. organizacaoId fica nulo de
    // propósito nas linhas históricas: o evento foi gravado antes da coluna
    // existir e não dá pra saber a qual organização ele pertencia — inferir
    // pela associação ATUAL do usuário reescreveria a história, que é
    // exatamente o que uma trilha de auditoria não pode fazer.
    await atribuirAplicacao(client, "logs_auditoria", aplicacaoId);

    await importarChaveDoAmbiente(client, chaveAes);

    await client.query("COMMIT");
    console.log("Backfill concluído.");
  } catch (erro) {
    await client.query("ROLLBACK");
    console.error("Backfill falhou, nada foi gravado —", erro.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

await principal();
