import { describe, expect, it } from "vitest";
import { criptografar, descriptografar } from "@/lib/cripto";

describe("Criptografia de dados em repouso (AES-256-GCM)", () => {
  it("faz o round-trip: descriptografar(criptografar(x)) === x", () => {
    const original = "NB2W45DFOIZA"; // formato de um segredo TOTP em base32
    const blob = criptografar(original);

    expect(blob).not.toBe(original);
    expect(descriptografar(blob)).toBe(original);
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
    const [iv, authTag, ciphertext] = criptografar("segredo-qualquer").split(":");
    const ciphertextAdulterado = Buffer.from(ciphertext, "base64");
    ciphertextAdulterado[0] ^= 0xff;
    const blobAdulterado = `${iv}:${authTag}:${ciphertextAdulterado.toString("base64")}`;

    expect(() => descriptografar(blobAdulterado)).toThrow();
  });
});
