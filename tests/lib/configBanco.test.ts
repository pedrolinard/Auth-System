import { describe, expect, it } from "vitest";
import { configuracaoPool, lerCertificadoCa } from "@/lib/configBanco";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
const URL_PRODUCAO = "postgresql://u:p@pooler.example.com:5432/postgres?sslmode=no-verify";

describe("Configuração do pool do banco (src/lib/configBanco.ts)", () => {
  it("sem DATABASE_CA_CERT a connection string fica intacta", () => {
    const config = configuracaoPool({ DATABASE_URL: URL_PRODUCAO });
    expect(config.connectionString).toBe(URL_PRODUCAO);
    expect(config.ssl).toBeUndefined();
    expect(config.max).toBeUndefined();
    expect(config.options).toBe("-c TimeZone=UTC");
  });

  it("com DATABASE_CA_CERT verifica o certificado e tira o sslmode da URL", () => {
    const config = configuracaoPool({ DATABASE_URL: URL_PRODUCAO, DATABASE_CA_CERT: PEM });
    expect(config.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
    expect(config.connectionString).not.toContain("sslmode");
    expect(config.connectionString).toContain("pooler.example.com:5432/postgres");
  });

  it("aceita o certificado em base64 ou com \\n escapado", () => {
    expect(lerCertificadoCa(Buffer.from(PEM).toString("base64"))).toBe(PEM);
    expect(lerCertificadoCa(PEM.replace(/\n/g, "\\n"))).toBe(PEM);
  });

  it("DATABASE_POOL_MAX só vale com um inteiro positivo", () => {
    expect(configuracaoPool({ DATABASE_URL: URL_PRODUCAO, DATABASE_POOL_MAX: "5" }).max).toBe(5);
    expect(configuracaoPool({ DATABASE_URL: URL_PRODUCAO, DATABASE_POOL_MAX: "abc" }).max).toBeUndefined();
    expect(configuracaoPool({ DATABASE_URL: URL_PRODUCAO, DATABASE_POOL_MAX: "0" }).max).toBeUndefined();
  });
});
