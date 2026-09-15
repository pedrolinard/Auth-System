import "server-only";

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalParaPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function criarClientePrisma() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    // Sessão do banco sempre em UTC. O adapter manda os instantes do JS sem
    // offset, e o Postgres interpreta esse texto no fuso DA SESSÃO — num
    // servidor fora de UTC (o Postgres local deste projeto roda em
    // America/Cayenne) cada data gravada ficava deslocada, e todo SQL que
    // compara com now() errava por horas: janela do rate limit, backfill das
    // migrations. Em produção o Supabase já está em UTC e nada muda; isto só
    // tira a dependência da configuração de quem hospeda o banco.
    options: "-c TimeZone=UTC",
  });

  return new PrismaClient({ adapter });
}

export const prisma = globalParaPrisma.prisma ?? criarClientePrisma();

if (process.env.NODE_ENV !== "production") {
  globalParaPrisma.prisma = prisma;
}
