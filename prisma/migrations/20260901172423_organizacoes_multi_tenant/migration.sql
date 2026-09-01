-- CreateEnum
CREATE TYPE "PapelOrganizacao" AS ENUM ('dono', 'admin', 'membro');

-- AlterTable
ALTER TABLE "tokens_atualizacao" ADD COLUMN     "organizacaoId" TEXT;

-- CreateTable
CREATE TABLE "organizacoes" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membros" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "papel" "PapelOrganizacao" NOT NULL DEFAULT 'membro',
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "convites_organizacao" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "papel" "PapelOrganizacao" NOT NULL DEFAULT 'membro',
    "criadoPorId" TEXT NOT NULL,
    "aceitoEm" TIMESTAMPTZ(3),
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "convites_organizacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizacoes_slug_key" ON "organizacoes"("slug");

-- CreateIndex
CREATE INDEX "membros_usuarioId_idx" ON "membros"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "membros_organizacaoId_usuarioId_key" ON "membros"("organizacaoId", "usuarioId");

-- CreateIndex
CREATE INDEX "convites_organizacao_organizacaoId_idx" ON "convites_organizacao"("organizacaoId");

-- CreateIndex
CREATE INDEX "convites_organizacao_email_idx" ON "convites_organizacao"("email");

-- CreateIndex
CREATE INDEX "tokens_atualizacao_organizacaoId_idx" ON "tokens_atualizacao"("organizacaoId");

-- AddForeignKey
ALTER TABLE "tokens_atualizacao" ADD CONSTRAINT "tokens_atualizacao_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "organizacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membros" ADD CONSTRAINT "membros_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "organizacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membros" ADD CONSTRAINT "membros_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convites_organizacao" ADD CONSTRAINT "convites_organizacao_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "organizacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
