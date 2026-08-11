// Rotaciona MFA_ENCRYPTION_KEY sem downtime: decifra o mfaSecret de cada
// usuário (com a chave atual ou, em fallback, a anterior) e re-cifra com a
// chave atual — ao final, todo mundo está na mesma chave/versão de formato.
//
// Procedimento de rotação:
//   1. Gere uma chave nova:
//      node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//   2. No ambiente, copie o valor ATUAL de MFA_ENCRYPTION_KEY para
//      MFA_ENCRYPTION_KEY_ANTERIOR, e troque MFA_ENCRYPTION_KEY pela chave
//      nova. Faça o deploy dessa mudança de env ANTES de rodar o script —
//      com as duas chaves presentes, leituras continuam funcionando
//      (fallback pra anterior) enquanto o script ainda não passou por todo
//      mundo.
//   3. Rode este script (contra o mesmo DATABASE_URL/env de produção):
//      node -r dotenv/config scripts/rotacionar-chave-mfa.mjs dotenv_config_path=.env
//   4. Confira a saída (0 falhas). Só então remova MFA_ENCRYPTION_KEY_ANTERIOR
//      do ambiente — a essa altura, nenhum registro depende mais dela.
//
// Roda fora do Next.js/TypeScript (node puro), então a lógica de
// cifrar/decifrar é uma cópia intencional de src/lib/cripto.ts — não dá pra
// importar aquele módulo TS diretamente daqui.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
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
    console.error(`${nomeEnv} precisa decodificar (base64) para exatamente 32 bytes (AES-256).`);
    process.exit(1);
  }
  return chave;
}

const chaveAtual = decodificarChave(requerEnv("MFA_ENCRYPTION_KEY"), "MFA_ENCRYPTION_KEY");
const chaveAnterior = process.env.MFA_ENCRYPTION_KEY_ANTERIOR
  ? decodificarChave(process.env.MFA_ENCRYPTION_KEY_ANTERIOR, "MFA_ENCRYPTION_KEY_ANTERIOR")
  : null;

function cifrar(texto) {
  const iv = randomBytes(TAMANHO_IV);
  const cifra = createCipheriv(ALGORITMO, chaveAtual, iv);
  const ciphertext = Buffer.concat([cifra.update(texto, "utf8"), cifra.final()]);
  const authTag = cifra.getAuthTag();
  return [VERSAO_FORMATO_ATUAL, iv, authTag, ciphertext]
    .map((parte) => (Buffer.isBuffer(parte) ? parte.toString("base64") : parte))
    .join(":");
}

function decifrarCom(chave, iv, authTag, ciphertext) {
  const decifra = createDecipheriv(ALGORITMO, chave, iv);
  decifra.setAuthTag(authTag);
  return Buffer.concat([decifra.update(ciphertext), decifra.final()]).toString("utf8");
}

async function principal() {
  const client = new pg.Client({ connectionString: requerEnv("DATABASE_URL") });
  await client.connect();

  const { rows } = await client.query(
    'SELECT id, "mfaSecret" FROM usuarios WHERE "mfaSecret" IS NOT NULL',
  );
  console.log(`Encontrados ${rows.length} usuário(s) com segredo TOTP salvo.`);

  let migrados = 0;
  let emDia = 0;
  let falhas = 0;

  for (const linha of rows) {
    const partes = linha.mfaSecret.split(":");
    const versionado = partes.length === 4 && partes[0] === VERSAO_FORMATO_ATUAL;
    const [ivB64, authTagB64, ciphertextB64] = versionado ? partes.slice(1) : partes;

    if (!ivB64 || !authTagB64 || !ciphertextB64) {
      falhas++;
      console.error(`Usuário ${linha.id}: formato de dado cifrado inválido, pulando.`);
      continue;
    }

    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");
    const ciphertext = Buffer.from(ciphertextB64, "base64");

    let segredoPlano;
    let jaNaChaveAtual = false;
    try {
      segredoPlano = decifrarCom(chaveAtual, iv, authTag, ciphertext);
      jaNaChaveAtual = versionado;
    } catch (erroComChaveAtual) {
      if (!chaveAnterior) {
        falhas++;
        console.error(
          `Usuário ${linha.id}: não decifrou com a chave atual e MFA_ENCRYPTION_KEY_ANTERIOR não está configurada.`,
        );
        continue;
      }
      try {
        segredoPlano = decifrarCom(chaveAnterior, iv, authTag, ciphertext);
      } catch {
        falhas++;
        console.error(`Usuário ${linha.id}: não decifrou nem com a chave atual, nem com a anterior.`);
        continue;
      }
    }

    if (jaNaChaveAtual) {
      emDia++;
      continue;
    }

    const recifrado = cifrar(segredoPlano);
    await client.query('UPDATE usuarios SET "mfaSecret" = $1 WHERE id = $2', [recifrado, linha.id]);
    migrados++;
  }

  console.log(
    `Rotação concluída: ${migrados} re-cifrado(s), ${emDia} já em dia, ${falhas} falha(s).`,
  );

  await client.end();
  if (falhas > 0) process.exit(1);
}

await principal();
