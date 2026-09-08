// Rotação da chave que assina o access token — o procedimento que o `kid` +
// JWKS tornaram possível fazer sem coordenar deploys.
//
// A ordem importa e é o ponto inteiro deste script:
//
//   1. gerar   → publica a chave nova no JWKS, INATIVA (ninguém assina com
//                ela ainda, mas todo consumidor já consegue descobri-la)
//   2. esperar → o cache de JWKS dos consumidores expirar (o Django usa
//                lifespan=300s; o header da rota usa a vida do access token)
//   3. ativar  → passa a assinar com a nova; a anterior fica publicada,
//                validando os tokens que ela ainda assinou
//   4. esperar → a vida de um access token (15 min) mais a janela de cache
//   5. remover → só então a chave velha sai do JWKS
//
// Pular o passo 2 é o erro clássico: assinar com uma chave que os
// consumidores ainda não conhecem derruba toda validação até o cache virar.
//
// node -r dotenv/config scripts/rotacionar-chave-assinatura.mjs <comando> [kid] dotenv_config_path=.env

import { createCipheriv, createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import pg from "pg";

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

// Cópia intencional de src/lib/cripto.ts, mesmo motivo dos outros scripts.
function cifrar(chaveAes, texto) {
  const iv = randomBytes(TAMANHO_IV);
  const cifra = createCipheriv(ALGORITMO, chaveAes, iv);
  const ciphertext = Buffer.concat([cifra.update(texto, "utf8"), cifra.final()]);
  return [VERSAO_FORMATO_ATUAL, iv, cifra.getAuthTag(), ciphertext]
    .map((parte) => (typeof parte === "string" ? parte : parte.toString("base64")))
    .join(":");
}

function gerarId() {
  return `c${randomBytes(12).toString("hex").slice(0, 23)}`;
}

// Mesma derivação de src/lib/chavesAssinatura.ts — se mudar lá, muda aqui.
function derivarKid(publicaPem) {
  return createHash("sha256").update(publicaPem).digest("hex").slice(0, 16);
}

async function listar(client) {
  const { rows } = await client.query(
    'SELECT kid, ativa, "aposentadaEm", "criadoEm" FROM chaves_assinatura ORDER BY "criadoEm" DESC',
  );
  if (rows.length === 0) {
    console.log("Nenhuma chave cadastrada — rode npm run backfill:aplicacoes primeiro.");
    return;
  }
  for (const linha of rows) {
    const estado = linha.ativa
      ? "ATIVA (assinando)"
      : linha.aposentadaEm
        ? `aposentada em ${linha.aposentadaEm.toISOString()}`
        : "publicada, ainda não ativada";
    console.log(`${linha.kid}  ${estado}`);
  }
}

async function gerar(client, chaveAes) {
  // 2048 bits é o mesmo tamanho que scripts/gerar-chaves-rs256.mjs usa pro par
  // original — trocar o tamanho no meio de uma rotação misturaria duas
  // mudanças num passo só.
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const kid = derivarKid(publicKey);
  await client.query(
    `INSERT INTO chaves_assinatura (id, kid, "publicaPem", "privadaCifrada", ativa, "criadoEm")
     VALUES ($1, $2, $3, $4, false, now())
     ON CONFLICT (kid) DO NOTHING`,
    [gerarId(), kid, publicKey, cifrar(chaveAes, privateKey)],
  );

  console.log(`Chave ${kid} gerada e publicada no JWKS, INATIVA.`);
  console.log("Espere o cache de JWKS dos consumidores expirar antes de ativar:");
  console.log(`  node -r dotenv/config scripts/rotacionar-chave-assinatura.mjs ativar ${kid} dotenv_config_path=.env`);
}

async function ativar(client, kid) {
  const { rows } = await client.query("SELECT kid FROM chaves_assinatura WHERE kid = $1", [kid]);
  if (rows.length === 0) {
    console.error(`Chave ${kid} não existe.`);
    process.exit(1);
  }

  // Numa transação só: um instante com duas chaves ativas (ou nenhuma) faria
  // o índice parcial estourar ou o app não achar chave pra assinar.
  await client.query("BEGIN");
  await client.query(
    'UPDATE chaves_assinatura SET ativa = false, "aposentadaEm" = now() WHERE ativa = true',
  );
  await client.query(
    'UPDATE chaves_assinatura SET ativa = true, "aposentadaEm" = NULL WHERE kid = $1',
    [kid],
  );
  await client.query("COMMIT");

  console.log(`Chave ${kid} ativa — os tokens novos já saem assinados com ela.`);
  console.log("A anterior segue publicada. Só remova depois de expirar o último token que ela assinou (15 min + cache).");
}

async function remover(client, kid) {
  const { rows } = await client.query(
    'SELECT ativa, "aposentadaEm" FROM chaves_assinatura WHERE kid = $1',
    [kid],
  );
  if (rows.length === 0) {
    console.error(`Chave ${kid} não existe.`);
    process.exit(1);
  }
  if (rows[0].ativa) {
    console.error(`Chave ${kid} é a ATIVA — ative outra antes de removê-la.`);
    process.exit(1);
  }

  // 15 min de access token + folga pro cache de JWKS. Remover antes disso
  // invalida sessões em andamento, que é justamente o que a rotação existe
  // pra evitar.
  const JANELA_SEGURA_MS = 30 * 60 * 1000;
  const aposentadaEm = rows[0].aposentadaEm;
  if (aposentadaEm && Date.now() - aposentadaEm.getTime() < JANELA_SEGURA_MS) {
    const faltam = Math.ceil((JANELA_SEGURA_MS - (Date.now() - aposentadaEm.getTime())) / 60000);
    console.error(`Chave ${kid} foi aposentada há pouco — espere mais ~${faltam} min.`);
    process.exit(1);
  }

  await client.query("DELETE FROM chaves_assinatura WHERE kid = $1", [kid]);
  console.log(`Chave ${kid} removida do JWKS.`);
}

async function principal() {
  const [comando, kid] = process.argv.slice(2).filter((arg) => !arg.startsWith("dotenv_config_"));
  const chaveAes = decodificarChave(requerEnv("MFA_ENCRYPTION_KEY"), "MFA_ENCRYPTION_KEY");
  const client = new pg.Client({ connectionString: requerEnv("DATABASE_URL") });
  await client.connect();

  try {
    if (comando === "listar") await listar(client);
    else if (comando === "gerar") await gerar(client, chaveAes);
    else if (comando === "ativar" && kid) await ativar(client, kid);
    else if (comando === "remover" && kid) await remover(client, kid);
    else {
      console.error("Uso: listar | gerar | ativar <kid> | remover <kid>");
      process.exitCode = 1;
    }
  } catch (erro) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Falhou —", erro.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

await principal();
