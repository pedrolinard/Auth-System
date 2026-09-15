-- Aprovação de aplicações self-service e desativação pelo operador. Aditiva:
-- o código anterior ignora as colunas.

-- AlterTable
ALTER TABLE "aplicacoes" ADD COLUMN IF NOT EXISTS "aprovada" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "aplicacoes" ADD COLUMN IF NOT EXISTS "desativadaPeloOperador" BOOLEAN NOT NULL DEFAULT false;

-- Aplicações que já existiam foram criadas por quem opera o provedor (antes
-- não havia self-service): continuam valendo como sempre valeram.
UPDATE "aplicacoes" SET "aprovada" = true WHERE "organizacaoDonaId" IS NULL AND "aprovada" = false;
