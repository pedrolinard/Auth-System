-- Login hospedado (OpenID Connect): URLs de retorno por aplicação e códigos de
-- autorização. Aditiva: o código anterior ignora a coluna e a tabela.

-- AlterTable
ALTER TABLE "aplicacoes" ADD COLUMN IF NOT EXISTS "redirectUris" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE IF NOT EXISTS "codigos_autorizacao" (
    "id" TEXT NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "aplicacaoId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "escopo" TEXT NOT NULL,
    "nonce" TEXT,
    "codeChallenge" TEXT NOT NULL,
    "autenticadoEm" TIMESTAMPTZ(3) NOT NULL,
    "expiraEm" TIMESTAMPTZ(3) NOT NULL,
    "usadoEm" TIMESTAMPTZ(3),
    "sessaoId" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codigos_autorizacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "codigos_autorizacao_codigoHash_key" ON "codigos_autorizacao"("codigoHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "codigos_autorizacao_expiraEm_idx" ON "codigos_autorizacao"("expiraEm");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'codigos_autorizacao_usuarioId_fkey') THEN
    ALTER TABLE "codigos_autorizacao" ADD CONSTRAINT "codigos_autorizacao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
