-- CreateTable
CREATE TABLE "limites_taxa" (
    "chave" TEXT NOT NULL,
    "contagem" INTEGER NOT NULL DEFAULT 1,
    "expiraEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "limites_taxa_pkey" PRIMARY KEY ("chave")
);

-- CreateIndex
CREATE INDEX "limites_taxa_expiraEm_idx" ON "limites_taxa"("expiraEm");
