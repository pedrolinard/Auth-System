import "server-only";

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalParaPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function criarClientePrisma() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });

  return new PrismaClient({ adapter });
}

export const prisma = globalParaPrisma.prisma ?? criarClientePrisma();

if (process.env.NODE_ENV !== "production") {
  globalParaPrisma.prisma = prisma;
}
