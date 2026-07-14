// Gera o par de chaves RS256 (PKCS8/SPKI) usado pelo access token, já
// codificado em base64 de uma linha só (pronto para colar no .env).
//
// Uso:
//   npm run gerar:chaves-rs256

import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

console.log(`JWT_ACCESS_PRIVATE_KEY_B64="${Buffer.from(privateKey).toString("base64")}"`);
console.log(`JWT_ACCESS_PUBLIC_KEY_B64="${Buffer.from(publicKey).toString("base64")}"`);
