-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('usuario', 'admin');

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "emailVerificado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "papel" "Papel" NOT NULL DEFAULT 'usuario';

-- CreateTable
CREATE TABLE "logs_auditoria" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT,
    "email" TEXT,
    "evento" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logs_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "logs_auditoria_usuarioId_idx" ON "logs_auditoria"("usuarioId");
