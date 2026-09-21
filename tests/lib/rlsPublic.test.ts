import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

// Guarda da migration 20260921120000_rls_public.
//
// A migration liga RLS nas tabelas que existiam quando ela rodou. Uma tabela
// criada por uma migration POSTERIOR nasce sem RLS, e os defaults do Supabase
// já concedem privilégios em `public` a `anon`/`authenticated` — então, se o
// Data API estiver ligado, o buraco reabre em silêncio. Este teste é o que
// transforma esse silêncio em suíte vermelha: ninguém precisa lembrar do
// docs/operacao.md item 11 ao criar uma tabela.
//
// Ligar RLS não afeta a aplicação: o Prisma conecta como DONO das tabelas, e
// dono contorna RLS (não há `FORCE ROW LEVEL SECURITY` em lugar nenhum).
describe("RLS no schema public", () => {
  it("toda tabela de public tem row level security ligada", async () => {
    const semRls = await prisma.$queryRaw<{ tabela: string }[]>`
      SELECT c.relname AS tabela
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND NOT c.relrowsecurity
      ORDER BY c.relname
    `;

    expect(semRls.map((linha) => linha.tabela)).toEqual([]);
  });

  it("nenhuma tabela usa FORCE row level security (o Prisma é dono e precisa contornar)", async () => {
    const comForce = await prisma.$queryRaw<{ tabela: string }[]>`
      SELECT c.relname AS tabela
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relforcerowsecurity
      ORDER BY c.relname
    `;

    expect(comForce.map((linha) => linha.tabela)).toEqual([]);
  });
});
