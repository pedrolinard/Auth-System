import "server-only";

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { configuracaoPool } from "@/lib/configBanco";

const globalParaPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function criarClientePrisma() {
  // TLS, fuso UTC da sessão e tamanho do pool: ver src/lib/configBanco.ts.
  const adapter = new PrismaPg(configuracaoPool(process.env));

  return new PrismaClient({ adapter });
}

export const prisma = globalParaPrisma.prisma ?? criarClientePrisma();

if (process.env.NODE_ENV !== "production") {
  globalParaPrisma.prisma = prisma;
}
