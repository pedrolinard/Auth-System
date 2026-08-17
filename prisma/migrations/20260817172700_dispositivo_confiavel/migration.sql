-- CreateTable
CREATE TABLE "dispositivos_confiaveis" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dispositivos_confiaveis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dispositivos_confiaveis_tokenHash_key" ON "dispositivos_confiaveis"("tokenHash");

-- CreateIndex
CREATE INDEX "dispositivos_confiaveis_usuarioId_idx" ON "dispositivos_confiaveis"("usuarioId");

-- AddForeignKey
ALTER TABLE "dispositivos_confiaveis" ADD CONSTRAINT "dispositivos_confiaveis_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
