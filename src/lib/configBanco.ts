import type { PoolConfig } from "pg";

// Parâmetros de TLS que a connection string pode trazer. Quando o CA é
// configurado, eles saem da URL: o pg dá precedência ao que vem na string
// sobre o objeto `ssl`, e um `sslmode=no-verify` esquecido ali desligaria de
// novo a verificação que o CA acabou de ligar.
const PARAMETROS_TLS_DA_URL = ["sslmode", "sslrootcert", "sslcert", "sslkey", "ssl", "uselibpqcompat"];

/** Aceita o PEM como veio (com quebras reais ou `\n` escapado) ou em base64. */
export function lerCertificadoCa(valor: string): string {
  const texto = valor.trim();
  if (texto.startsWith("-----BEGIN")) return texto.replace(/\\n/g, "\n");
  return Buffer.from(texto, "base64").toString("utf8").trim();
}

/**
 * Configuração do pool do Postgres a partir do ambiente.
 *
 * - Sem `DATABASE_CA_CERT`: a connection string manda sozinha, como sempre
 *   foi (em produção ela traz `sslmode=no-verify` — cifrado, mas sem conferir
 *   o certificado do servidor).
 * - Com `DATABASE_CA_CERT` (o certificado CA do Supabase, Settings → Database
 *   → SSL): TLS com verificação completa — cadeia E nome do host. Um
 *   intermediário na rede não consegue mais se passar pelo banco.
 * - `DATABASE_POOL_MAX`: teto de conexões por instância (padrão do pg: 10).
 */
export function configuracaoPool(env: Record<string, string | undefined>): PoolConfig {
  const config: PoolConfig = {
    connectionString: env.DATABASE_URL,
    // Sessão do banco sempre em UTC. O adapter manda os instantes do JS sem
    // offset, e o Postgres interpreta esse texto no fuso DA SESSÃO — num
    // servidor fora de UTC (o Postgres local deste projeto roda em
    // America/Cayenne) cada data gravada ficava deslocada, e todo SQL que
    // compara com now() errava por horas: janela do rate limit, backfill das
    // migrations. Em produção o Supabase já está em UTC e nada muda; isto só
    // tira a dependência da configuração de quem hospeda o banco.
    options: "-c TimeZone=UTC",
  };

  const maximo = Number(env.DATABASE_POOL_MAX);
  if (Number.isInteger(maximo) && maximo > 0) config.max = maximo;

  if (env.DATABASE_CA_CERT?.trim() && env.DATABASE_URL) {
    const url = new URL(env.DATABASE_URL);
    for (const parametro of PARAMETROS_TLS_DA_URL) url.searchParams.delete(parametro);
    config.connectionString = url.toString();
    config.ssl = { ca: lerCertificadoCa(env.DATABASE_CA_CERT), rejectUnauthorized: true };
  }

  return config;
}
