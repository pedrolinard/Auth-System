-- Fila de organizações cujos dados no serviço Django ainda precisam ser
-- excluídos. Tabela nova: o código anterior não a conhece e segue igual.

-- CreateTable
CREATE TABLE IF NOT EXISTS "exclusoes_dominio_pendentes" (
    "organizacaoId" TEXT NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exclusoes_dominio_pendentes_pkey" PRIMARY KEY ("organizacaoId")
);
