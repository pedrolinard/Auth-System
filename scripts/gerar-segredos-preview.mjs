// Gera os segredos do ambiente Preview da Vercel num arquivo local, sem
// imprimir nenhum valor no terminal (docs/operacao.md, item 6).
//
// Todos os valores são NOVOS: o Preview nunca pode ter segredo de produção. Um
// Preview roda código de qualquer branch, e com a chave de produção um token
// emitido lá valeria aqui.
//
// O arquivo (.env* está no .gitignore) serve a dois usos:
//   - alimentar o prisma migrate deploy e o backfill contra o banco do Preview
//     (node --env-file=.env.preview ...), depois de preencher DATABASE_URL;
//   - ser copiado para Vercel → Settings → Environment Variables, marcando só
//     "Preview".
//
// Uso:
//   npm run gerar:segredos-preview                  # escreve .env.preview
//   npm run gerar:segredos-preview -- outro-arquivo # outro caminho
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const destino = process.argv[2] ?? ".env.preview";

// Não sobrescreve: se o arquivo já existe, os segredos dele podem já estar na
// Vercel e cifrando a chave de assinatura no banco do Preview. Trocar só um
// lado deixa o Preview sem conseguir ler a própria chave.
if (existsSync(destino)) {
  console.error(`${destino} já existe. Apague-o de propósito se quiser gerar tudo de novo.`);
  process.exit(1);
}

const segredo = () => randomBytes(48).toString("base64url");
const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const variaveis = {
  JWT_ACCESS_PRIVATE_KEY_B64: Buffer.from(privateKey).toString("base64"),
  JWT_ACCESS_PUBLIC_KEY_B64: Buffer.from(publicKey).toString("base64"),
  JWT_REFRESH_SECRET: segredo(),
  JWT_MFA_SECRET: segredo(),
  JWT_VERIFICACAO_EMAIL_SECRET: segredo(),
  JWT_REDEFINICAO_SENHA_SECRET: segredo(),
  JWT_ALTERACAO_EMAIL_SECRET: segredo(),
  JWT_PASSKEY_SECRET: segredo(),
  JWT_CONVITE_ORGANIZACAO_SECRET: segredo(),
  // 32 bytes exatos (AES-256), ver src/lib/cripto.ts. Cifra a chave privada de
  // assinatura no banco do Preview: tem que ser a MESMA aqui e na Vercel.
  MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};

const conteudo = [
  "# Segredos do ambiente PREVIEW da Vercel — gerados por scripts/gerar-segredos-preview.mjs.",
  "# Nunca use estes valores em produção, nem os de produção aqui. Não commitar.",
  "#",
  "# Preencha DATABASE_URL com a connection string do projeto Supabase do Preview",
  "# (mfpjqueyefqqzewksqgt), NUNCA a de produção (wrqlmjdssiszzkcsvzif).",
  'DATABASE_URL=""',
  "# O servidor não sobe sem BASE_URL. No Preview ela só monta links de e-mail, e",
  "# sem RESEND_API_KEY (que o Preview não deve ter) nenhum e-mail sai.",
  'BASE_URL="https://auth-gateway-kappa.vercel.app"',
  "",
  ...Object.entries(variaveis).map(([nome, valor]) => `${nome}="${valor}"`),
  "",
].join("\n");

// 0o600: só o dono lê. No Windows o modo é ignorado; vale o .gitignore.
writeFileSync(destino, conteudo, { mode: 0o600 });

console.log(`Escrito em ${destino} (nenhum valor impresso aqui):`);
for (const nome of ["DATABASE_URL (vazio — preencha)", "BASE_URL", ...Object.keys(variaveis)]) {
  console.log(`  - ${nome}`);
}
console.log("\nPróximos passos: docs/operacao.md, item 6.");
