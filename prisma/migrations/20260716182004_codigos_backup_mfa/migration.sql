-- CreateTable
CREATE TABLE "codigos_backup_mfa" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "usadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codigos_backup_mfa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "codigos_backup_mfa_codigoHash_key" ON "codigos_backup_mfa"("codigoHash");

-- CreateIndex
CREATE INDEX "codigos_backup_mfa_usuarioId_idx" ON "codigos_backup_mfa"("usuarioId");

-- AddForeignKey
ALTER TABLE "codigos_backup_mfa" ADD CONSTRAINT "codigos_backup_mfa_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
