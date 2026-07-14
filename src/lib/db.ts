import "server-only";

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalParaPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function criarClientePrisma() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });

  return new PrismaClient({ adapter });
}

export const prisma = globalParaPrisma.prisma ?? criarClientePrisma();

if (process.env.NODE_ENV !== "production") {
  globalParaPrisma.prisma = prisma;
}
