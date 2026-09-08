-- AlterTable
ALTER TABLE "logs_auditoria" ADD COLUMN     "aplicacaoId" TEXT,
ADD COLUMN     "organizacaoId" TEXT;

-- AlterTable
ALTER TABLE "organizacoes" ADD COLUMN     "aplicacaoId" TEXT;

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "aplicacaoId" TEXT;

-- CreateTable
CREATE TABLE "aplicacoes" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretHash" TEXT,
    "origens" TEXT[],
    "passkeyRpId" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "aplicacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chaves_assinatura" (
    "id" TEXT NOT NULL,
    "kid" TEXT NOT NULL,
    "publicaPem" TEXT NOT NULL,
    "privadaCifrada" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT false,
    "aposentadaEm" TIMESTAMPTZ(3),
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chaves_assinatura_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "aplicacoes_clientId_key" ON "aplicacoes"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "chaves_assinatura_kid_key" ON "chaves_assinatura"("kid");

-- CreateIndex
CREATE INDEX "logs_auditoria_aplicacaoId_criadoEm_idx" ON "logs_auditoria"("aplicacaoId", "criadoEm");

-- CreateIndex
CREATE INDEX "logs_auditoria_organizacaoId_criadoEm_idx" ON "logs_auditoria"("organizacaoId", "criadoEm");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_aplicacaoId_fkey" FOREIGN KEY ("aplicacaoId") REFERENCES "aplicacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizacoes" ADD CONSTRAINT "organizacoes_aplicacaoId_fkey" FOREIGN KEY ("aplicacaoId") REFERENCES "aplicacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Índices únicos PARCIAIS, escritos à mão: o Prisma não expressa "único
-- apenas quando a coluna é true" no schema, e sem eles nada impede duas
-- aplicações padrão (requisição sem client id não saberia em qual cair) nem
-- duas chaves ativas ao mesmo tempo (dois kid assinando em paralelo).
CREATE UNIQUE INDEX "aplicacoes_padrao_unica" ON "aplicacoes" ("padrao") WHERE "padrao" = true;
CREATE UNIQUE INDEX "chaves_assinatura_ativa_unica" ON "chaves_assinatura" ("ativa") WHERE "ativa" = true;
