-- Fila de exclusões de dados no serviço Django ("organizacao:<id>" ou
-- "usuario:<id>"). Tabela nova: o código anterior não a conhece e segue igual.

-- CreateTable
CREATE TABLE IF NOT EXISTS "exclusoes_dominio_pendentes" (
    "alvo" TEXT NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exclusoes_dominio_pendentes_pkey" PRIMARY KEY ("alvo")
);
