import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITMO = "aes-256-gcm";
const TAMANHO_IV = 12; // 96 bits, recomendado pelo NIST para GCM
const VERSAO_FORMATO_ATUAL = "v1";

function decodificarChave(valor: string, nomeEnv: string): Buffer {
  const chave = Buffer.from(valor, "base64");
  if (chave.length !== 32) {
    throw new Error(`${nomeEnv} precisa decodificar (base64) para exatamente 32 bytes (AES-256).`);
  }
  return chave;
}

let chaveAtual: Buffer | null = null;
function obterChaveAtual(): Buffer {
  if (!chaveAtual) {
    chaveAtual = decodificarChave(process.env.MFA_ENCRYPTION_KEY!, "MFA_ENCRYPTION_KEY");
  }
  return chaveAtual;
}

// Chave anterior: opcional, só usada como fallback na leitura durante uma
// rotação em andamento (ver scripts/rotacionar-chave-mfa.mjs). Sem ela
// configurada, trocar MFA_ENCRYPTION_KEY tornaria todo dado já cifrado
// ilegível de uma vez — com ela, dá pra decifrar o que ainda não foi
// re-cifrado enquanto o script de rotação passa por todos os registros.
let chaveAnteriorCarregada = false;
let chaveAnterior: Buffer | null = null;
function obterChaveAnterior(): Buffer | null {
  if (!chaveAnteriorCarregada) {
    chaveAnteriorCarregada = true;
    chaveAnterior = process.env.MFA_ENCRYPTION_KEY_ANTERIOR
      ? decodificarChave(process.env.MFA_ENCRYPTION_KEY_ANTERIOR, "MFA_ENCRYPTION_KEY_ANTERIOR")
      : null;
  }
  return chaveAnterior;
}

function cifrarCom(chave: Buffer, texto: string): string {
  const iv = randomBytes(TAMANHO_IV);
  const cifra = createCipheriv(ALGORITMO, chave, iv);
  const ciphertext = Buffer.concat([cifra.update(texto, "utf8"), cifra.final()]);
  const authTag = cifra.getAuthTag();

  return [iv, authTag, ciphertext].map((parte) => parte.toString("base64")).join(":");
}

function decifrarCom(chave: Buffer, iv: Buffer, authTag: Buffer, ciphertext: Buffer): string {
  const decifra = createDecipheriv(ALGORITMO, chave, iv);
  decifra.setAuthTag(authTag);
  return Buffer.concat([decifra.update(ciphertext), decifra.final()]).toString("utf8");
}

// Criptografia simétrica autenticada (AES-256-GCM) para dados sensíveis em
// repouso (ex.: segredo TOTP) — diferente dos segredos JWT em token.ts, que
// assinam/verificam tokens efêmeros, esta chave protege dados persistidos no
// banco. Formato de saída versionado: "v1:iv:authTag:ciphertext", tudo em
// base64 — o prefixo de versão é o que permite, no futuro, trocar o
// algoritmo/formato sem quebrar dados cifrados com a versão anterior.
export function criptografar(texto: string): string {
  return `${VERSAO_FORMATO_ATUAL}:${cifrarCom(obterChaveAtual(), texto)}`;
}

export function descriptografar(blob: string): string {
  const partes = blob.split(":");

  // Formato pré-versionamento ("iv:authTag:ciphertext", 3 partes) — dado
  // cifrado antes desta função existir. Tratado à parte pra não quebrar
  // quem já tinha segredos TOTP salvos antes da rotação de chave existir.
  const versionado = partes.length === 4;
  const [ivB64, authTagB64, ciphertextB64] = versionado ? partes.slice(1) : partes;

  if (versionado && partes[0] !== VERSAO_FORMATO_ATUAL) {
    throw new Error(`Versão de formato cifrado desconhecida: "${partes[0]}".`);
  }
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Formato inválido de dado cifrado.");
  }

  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  try {
    return decifrarCom(obterChaveAtual(), iv, authTag, ciphertext);
  } catch (erroComChaveAtual) {
    // A chave atual não decifrou (ex.: MFA_ENCRYPTION_KEY acabou de rotacionar
    // e este registro ainda não foi re-cifrado) — tenta a anterior antes de
    // desistir. Sem MFA_ENCRYPTION_KEY_ANTERIOR configurada, propaga o erro
    // original da chave atual.
    const anterior = obterChaveAnterior();
    if (!anterior) throw erroComChaveAtual;
    return decifrarCom(anterior, iv, authTag, ciphertext);
  }
}
