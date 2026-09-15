-- Tipo de cliente (público ou confidencial) por aplicação e escopo OIDC por
-- sessão. Aditiva: o código anterior ignora as colunas. Aplicações existentes
-- ficam confidenciais (o padrão seguro).

-- AlterTable
ALTER TABLE "aplicacoes" ADD COLUMN IF NOT EXISTS "clientePublico" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tokens_atualizacao" ADD COLUMN IF NOT EXISTS "escopoOidc" TEXT;

-- AlterTable
ALTER TABLE "codigos_autorizacao" ADD COLUMN IF NOT EXISTS "reapresentadoEm" TIMESTAMPTZ(3);
