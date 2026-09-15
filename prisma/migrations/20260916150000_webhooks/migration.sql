-- Webhooks por aplicação cliente e o histórico de entregas. Tabelas novas: o
-- código anterior não as conhece e segue igual.

-- CreateTable
CREATE TABLE IF NOT EXISTS "webhooks_aplicacao" (
    "id" TEXT NOT NULL,
    "aplicacaoId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "segredoCifrado" TEXT NOT NULL,
    "eventos" TEXT[],
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "desativadoMotivo" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webhooks_aplicacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "entregas_webhook" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entregueEm" TIMESTAMPTZ(3),
    "desistiuEm" TIMESTAMPTZ(3),
    "ultimoStatus" INTEGER,
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entregas_webhook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "webhooks_aplicacao_aplicacaoId_idx" ON "webhooks_aplicacao"("aplicacaoId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "entregas_webhook_webhookId_criadoEm_idx" ON "entregas_webhook"("webhookId", "criadoEm");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "entregas_webhook_entregueEm_desistiuEm_proximaTentativaEm_idx" ON "entregas_webhook"("entregueEm", "desistiuEm", "proximaTentativaEm");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhooks_aplicacao_aplicacaoId_fkey') THEN
    ALTER TABLE "webhooks_aplicacao" ADD CONSTRAINT "webhooks_aplicacao_aplicacaoId_fkey" FOREIGN KEY ("aplicacaoId") REFERENCES "aplicacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entregas_webhook_webhookId_fkey') THEN
    ALTER TABLE "entregas_webhook" ADD CONSTRAINT "entregas_webhook_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "webhooks_aplicacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
