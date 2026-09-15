-- Marca da aplicação nos e-mails. Só aditiva e toda opcional: sem os campos,
-- os e-mails continuam saindo como antes.

-- AlterTable
ALTER TABLE "aplicacoes" ADD COLUMN IF NOT EXISTS "emailRemetente" TEXT,
ADD COLUMN IF NOT EXISTS "urlLinks" TEXT,
ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
