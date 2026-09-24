-- Fase 2 da saída das colunas legadas de suspensão de "usuarios".
--
-- A suspensão passou a ser por organização (membros.suspenso, migration
-- 20260914120000_suspensao_por_membro, que copiou as suspensões ativas). A
-- fase 1 tirou os três campos do schema.prisma sem migration: o código no ar
-- desde fbee4c0 já não os seleciona, então derrubá-los não quebra nada que
-- esteja rodando. Esta migration só pode ser aplicada DEPOIS daquele deploy.
--
-- IF EXISTS: idempotente, como as outras rodadas à mão no SQL Editor.

-- AlterTable
ALTER TABLE "usuarios" DROP COLUMN IF EXISTS "suspenso",
DROP COLUMN IF EXISTS "suspensoAte",
DROP COLUMN IF EXISTS "suspensoMotivo";
