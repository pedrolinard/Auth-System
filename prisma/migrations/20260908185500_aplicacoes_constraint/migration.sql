-- Migration destrutiva: e-mail deixa de ser único no sistema e passa a ser
-- único POR APLICAÇÃO; o mesmo vale pro slug de organização.
--
-- O bloco de dados abaixo existe por uma razão específica, aprendida na
-- prática: `npm run build` roda `prisma migrate deploy`, que aplica TODAS as
-- migrations pendentes de uma vez. Se esta migration dependesse de um script
-- externo ter rodado entre ela e a anterior, um deploy normal a aplicaria
-- junto com a aditiva, o SET NOT NULL falharia com "contém valores nulos", e
-- o build inteiro morreria — o mesmo tipo de deploy quebrado que já custou
-- uma semana neste projeto.
--
-- Então ela se vira sozinha: se ainda houver linha sem aplicação, cria a
-- aplicação padrão e atribui tudo a ela. Idempotente — se
-- scripts/backfill-aplicacoes.mjs já rodou (o caminho preferido, que também
-- preenche origens/RP ID e importa a chave de assinatura), nada aqui tem
-- efeito.

INSERT INTO "aplicacoes" ("id", "nome", "clientId", "origens", "ativa", "padrao", "criadoEm", "atualizadoEm")
SELECT
  'aplicacao_padrao_bootstrap',
  'Aplicação padrão',
  'app_' || md5(random()::text || clock_timestamp()::text),
  ARRAY[]::text[],
  true,
  true,
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM "aplicacoes" WHERE "padrao" = true);

UPDATE "usuarios"      SET "aplicacaoId" = (SELECT "id" FROM "aplicacoes" WHERE "padrao" = true) WHERE "aplicacaoId" IS NULL;
UPDATE "organizacoes"  SET "aplicacaoId" = (SELECT "id" FROM "aplicacoes" WHERE "padrao" = true) WHERE "aplicacaoId" IS NULL;
UPDATE "logs_auditoria" SET "aplicacaoId" = (SELECT "id" FROM "aplicacoes" WHERE "padrao" = true) WHERE "aplicacaoId" IS NULL;

-- IF EXISTS / IF NOT EXISTS em tudo: uma migration que já falhou no meio
-- (o SET NOT NULL abaixo aborta quando o backfill não rodou) deixa parte dos
-- índices aplicada, e sem isso a segunda tentativa morre num erro diferente
-- do original — que foi exatamente o que aconteceu ao escrever esta migration.
DROP INDEX IF EXISTS "organizacoes_slug_key";
DROP INDEX IF EXISTS "usuarios_email_key";
ALTER TABLE "organizacoes" ALTER COLUMN "aplicacaoId" SET NOT NULL;
ALTER TABLE "usuarios" ALTER COLUMN "aplicacaoId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "organizacoes_aplicacaoId_idx" ON "organizacoes"("aplicacaoId");
CREATE UNIQUE INDEX IF NOT EXISTS "organizacoes_aplicacaoId_slug_key" ON "organizacoes"("aplicacaoId", "slug");
CREATE INDEX IF NOT EXISTS "usuarios_aplicacaoId_idx" ON "usuarios"("aplicacaoId");
CREATE UNIQUE INDEX IF NOT EXISTS "usuarios_aplicacaoId_email_key" ON "usuarios"("aplicacaoId", "email");
