-- Suspensão passa a ser por organização (Membro), não por conta (Usuario).
--
-- Só aditiva: as colunas de usuarios ficam, porque o código anterior ainda
-- as lê e escreve na janela entre esta migration e o deploy do código novo.
-- Saem numa migration posterior.

-- AlterTable
ALTER TABLE "membros" ADD COLUMN IF NOT EXISTS "suspenso" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "suspensoAte" TIMESTAMPTZ(3),
ADD COLUMN IF NOT EXISTS "suspensoMotivo" TEXT;

-- Backfill: toda suspensão de conta AINDA ATIVA vira suspensão em cada
-- organização de que a pessoa participa. Não dá pra saber qual organização
-- suspendeu (o campo era global), então preserva o efeito de hoje — bloqueada
-- em todas — e cada organização passa a poder reativar só a própria parte.
-- Suspensão já expirada não é copiada. Idempotente: rodar de novo reescreve
-- os mesmos valores.
UPDATE "membros" AS m
SET "suspenso" = true,
    "suspensoAte" = u."suspensoAte",
    "suspensoMotivo" = u."suspensoMotivo"
FROM "usuarios" AS u
WHERE m."usuarioId" = u."id"
  AND u."suspenso" = true
  AND (u."suspensoAte" IS NULL OR u."suspensoAte" > CURRENT_TIMESTAMP);
