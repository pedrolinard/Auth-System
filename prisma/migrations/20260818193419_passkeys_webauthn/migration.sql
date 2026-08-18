-- CreateTable
CREATE TABLE "passkeys" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "contador" INTEGER NOT NULL DEFAULT 0,
    "transportes" TEXT[],
    "nome" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoUsoEm" TIMESTAMPTZ(3),

    CONSTRAINT "passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "passkeys_credentialId_key" ON "passkeys"("credentialId");

-- CreateIndex
CREATE INDEX "passkeys_usuarioId_idx" ON "passkeys"("usuarioId");

-- AddForeignKey
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
