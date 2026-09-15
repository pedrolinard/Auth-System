-- Alvo de eventos que não são sobre uma conta (ex.: qual aplicação foi editada).
-- Só aditiva e opcional: o código anterior ignora a coluna.

-- AlterTable
ALTER TABLE "logs_auditoria" ADD COLUMN IF NOT EXISTS "alvo" TEXT;
