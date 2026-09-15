-- Motivo da revogação de uma sessão. Só aditiva: o código anterior ignora a
-- coluna, e token revogado antes dela (motivo nulo) segue tratado como
-- rotação pela detecção de reuso.

-- AlterTable
ALTER TABLE "tokens_atualizacao" ADD COLUMN IF NOT EXISTS "revogadoMotivo" TEXT;
