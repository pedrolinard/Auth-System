-- Aplicações self-service: a organização (da aplicação padrão) que criou e
-- gerencia a aplicação. Só aditiva e opcional: o código anterior ignora a
-- coluna, e as aplicações existentes ficam com NULL (geridas pelo operador).

-- AlterTable
ALTER TABLE "aplicacoes" ADD COLUMN IF NOT EXISTS "organizacaoDonaId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "aplicacoes_organizacaoDonaId_idx" ON "aplicacoes"("organizacaoDonaId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aplicacoes_organizacaoDonaId_fkey') THEN
    ALTER TABLE "aplicacoes" ADD CONSTRAINT "aplicacoes_organizacaoDonaId_fkey" FOREIGN KEY ("organizacaoDonaId") REFERENCES "organizacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
