import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITMO = "aes-256-gcm";
const TAMANHO_IV = 12; // 96 bits, recomendado pelo NIST para GCM

let chave: Buffer | null = null;
function obterChave(): Buffer {
  if (!chave) {
    chave = Buffer.from(process.env.MFA_ENCRYPTION_KEY!, "base64");
    if (chave.length !== 32) {
      throw new Error(
        "MFA_ENCRYPTION_KEY precisa decodificar (base64) para exatamente 32 bytes (AES-256).",
      );
    }
  }
  return chave;
}

// Criptografia simétrica autenticada (AES-256-GCM) para dados sensíveis em
// repouso (ex.: segredo TOTP) — diferente dos segredos JWT em token.ts, que
// assinam/verificam tokens efêmeros, esta chave protege dados persistidos no
// banco. Formato de saída: "iv:authTag:ciphertext", tudo em base64.
export function criptografar(texto: string): string {
  const iv = randomBytes(TAMANHO_IV);
  const cifra = createCipheriv(ALGORITMO, obterChave(), iv);
  const ciphertext = Buffer.concat([cifra.update(texto, "utf8"), cifra.final()]);
  const authTag = cifra.getAuthTag();

  return [iv, authTag, ciphertext].map((parte) => parte.toString("base64")).join(":");
}

export function descriptografar(blob: string): string {
  const [ivB64, authTagB64, ciphertextB64] = blob.split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Formato inválido de dado cifrado.");
  }

  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  const decifra = createDecipheriv(ALGORITMO, obterChave(), iv);
  decifra.setAuthTag(authTag);

  return Buffer.concat([decifra.update(ciphertext), decifra.final()]).toString("utf8");
}
