import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { criptografar, descriptografar } from "@/lib/cripto";

const MFA_ENCRYPTION_KEY_ORIGINAL = process.env.MFA_ENCRYPTION_KEY;
const MFA_ENCRYPTION_KEY_ANTERIOR_ORIGINAL = process.env.MFA_ENCRYPTION_KEY_ANTERIOR;

function gerarChaveBase64(): string {
  return randomBytes(32).toString("base64");
}

describe("Criptografia de dados em repouso (AES-256-GCM)", () => {
  afterEach(() => {
    process.env.MFA_ENCRYPTION_KEY = MFA_ENCRYPTION_KEY_ORIGINAL;
    process.env.MFA_ENCRYPTION_KEY_ANTERIOR = MFA_ENCRYPTION_KEY_ANTERIOR_ORIGINAL;
    vi.resetModules();
  });

  it("faz o round-trip: descriptografar(criptografar(x)) === x", () => {
    const original = "NB2W45DFOIZA"; // formato de um segredo TOTP em base32
    const blob = criptografar(original);

    expect(blob).not.toBe(original);
    expect(descriptografar(blob)).toBe(original);
  });

  it("gera o blob com o prefixo de versão v1", () => {
    const blob = criptografar("segredo-qualquer");
    const partes = blob.split(":");

    expect(partes).toHaveLength(4);
    expect(partes[0]).toBe("v1");
  });

  it("gera ciphertexts diferentes para o mesmo texto (IV aleatório)", () => {
    const original = "NB2W45DFOIZA";
    const blobA = criptografar(original);
    const blobB = criptografar(original);

    expect(blobA).not.toBe(blobB);
    expect(descriptografar(blobA)).toBe(original);
    expect(descriptografar(blobB)).toBe(original);
  });

  it("rejeita um blob adulterado (autenticação do GCM falha)", () => {
    const [versao, iv, authTag, ciphertext] = criptografar("segredo-qualquer").split(":");
    const ciphertextAdulterado = Buffer.from(ciphertext, "base64");
    ciphertextAdulterado[0] ^= 0xff;
    const blobAdulterado = `${versao}:${iv}:${authTag}:${ciphertextAdulterado.toString("base64")}`;

    expect(() => descriptografar(blobAdulterado)).toThrow();
  });

  it("rejeita um prefixo de versão desconhecido", () => {
    const [, iv, authTag, ciphertext] = criptografar("segredo-qualquer").split(":");
    const blobVersaoErrada = `v99:${iv}:${authTag}:${ciphertext}`;

    expect(() => descriptografar(blobVersaoErrada)).toThrow(/versão/i);
  });

  it("decifra o formato legado pré-versionamento (3 partes, sem prefixo)", async () => {
    // Simula um dado cifrado antes desta função ter prefixo de versão —
    // formato antigo "iv:authTag:ciphertext" continua legível.
    vi.resetModules();
    const chave = gerarChaveBase64();
    process.env.MFA_ENCRYPTION_KEY = chave;
    delete process.env.MFA_ENCRYPTION_KEY_ANTERIOR;

    const { createCipheriv } = await import("node:crypto");
    const iv = randomBytes(12);
    const cifra = createCipheriv("aes-256-gcm", Buffer.from(chave, "base64"), iv);
    const ciphertext = Buffer.concat([cifra.update("segredo-legado", "utf8"), cifra.final()]);
    const authTag = cifra.getAuthTag();
    const blobLegado = [iv, authTag, ciphertext].map((p) => p.toString("base64")).join(":");

    const { descriptografar: descriptografarComChaveNova } = await import("@/lib/cripto");
    expect(descriptografarComChaveNova(blobLegado)).toBe("segredo-legado");
  });

  it("com MFA_ENCRYPTION_KEY_ANTERIOR configurada, decifra um blob cifrado com a chave antiga", async () => {
    vi.resetModules();
    const chaveAntiga = gerarChaveBase64();
    process.env.MFA_ENCRYPTION_KEY = chaveAntiga;
    delete process.env.MFA_ENCRYPTION_KEY_ANTERIOR;
    const { criptografar: criptografarComChaveAntiga } = await import("@/lib/cripto");
    const blobComChaveAntiga = criptografarComChaveAntiga("segredo-pre-rotacao");

    // "Rotaciona": a antiga vira MFA_ENCRYPTION_KEY_ANTERIOR, uma nova entra
    // como MFA_ENCRYPTION_KEY.
    vi.resetModules();
    process.env.MFA_ENCRYPTION_KEY = gerarChaveBase64();
    process.env.MFA_ENCRYPTION_KEY_ANTERIOR = chaveAntiga;
    const { descriptografar: descriptografarPosRotacao } = await import("@/lib/cripto");

    expect(descriptografarPosRotacao(blobComChaveAntiga)).toBe("segredo-pre-rotacao");
  });

  it("sem MFA_ENCRYPTION_KEY_ANTERIOR, um blob da chave antiga não decifra mais", async () => {
    vi.resetModules();
    const chaveAntiga = gerarChaveBase64();
    process.env.MFA_ENCRYPTION_KEY = chaveAntiga;
    delete process.env.MFA_ENCRYPTION_KEY_ANTERIOR;
    const { criptografar: criptografarComChaveAntiga } = await import("@/lib/cripto");
    const blobComChaveAntiga = criptografarComChaveAntiga("segredo-pre-rotacao");

    vi.resetModules();
    process.env.MFA_ENCRYPTION_KEY = gerarChaveBase64();
    delete process.env.MFA_ENCRYPTION_KEY_ANTERIOR;
    const { descriptografar: descriptografarSemAnterior } = await import("@/lib/cripto");

    expect(() => descriptografarSemAnterior(blobComChaveAntiga)).toThrow();
  });
});
