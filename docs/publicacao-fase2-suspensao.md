# Publicação — fase 2 das colunas legadas de suspensão

Remove `suspenso`, `suspensoAte` e `suspensoMotivo` da tabela `usuarios`. A
suspensão é por organização (`membros.suspenso`) desde 2026-09-14, e a fase 1
(`fbee4c0`, no ar desde 2026-09-24) tirou os campos do `schema.prisma`: o
código em produção já não lê nem escreve essas colunas.

Uma migration só, `20260924200000_remover_suspensao_legada_usuario`. Sem
variável de ambiente nova, sem mudança de token, sem deploy do Django.

## Ordem

1. **Confira que `fbee4c0` (ou depois) é o deploy de produção** do
   `auth-gateway` na Vercel. Com código anterior à fase 1 no ar, o `DROP`
   derruba o login.
2. **Rode o SQL abaixo** no SQL Editor do projeto de **produção**:
   https://supabase.com/dashboard/project/wrqlmjdssiszzkcsvzif/sql/new
   (não o `mfpjqueyefqqzewksqgt`, que é o Preview).
3. **Confira o site**: login e a tela de usuários da organização.
4. **Merge do PR** na `main`. O portão do build (`checar-migrations.mjs`)
   encontra a migration já registrada e deixa o deploy subir.

Se o merge vier antes do SQL, nada quebra: o build de produção para no portão
("migration pendente") e o deploy anterior continua no ar até o SQL rodar.

## SQL (produção)

Transação única: se qualquer comando falhar, nada muda. Idempotente: rodar de
novo não faz nada. O checksum é o que o Prisma calcula do `migration.sql`
(conferido contra o arquivo no git).

```sql
BEGIN;

-- 20260924200000_remover_suspensao_legada_usuario
ALTER TABLE "usuarios" DROP COLUMN IF EXISTS "suspenso",
DROP COLUMN IF EXISTS "suspensoAte",
DROP COLUMN IF EXISTS "suspensoMotivo";

-- Registro pro Prisma considerar aplicada
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text,
       '9800b37500e7e8c657f485ade2945699099f38f61671a45f76aac0778bfe4c0f',
       now(), '20260924200000_remover_suspensao_legada_usuario', NULL, NULL, now(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20260924200000_remover_suspensao_legada_usuario'
);

COMMIT;

-- Conferência: esperado 0 | 1
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'usuarios'
      AND column_name IN ('suspenso', 'suspensoAte', 'suspensoMotivo')) AS colunas_legadas,
  (SELECT count(*) FROM "_prisma_migrations"
    WHERE migration_name = '20260924200000_remover_suspensao_legada_usuario') AS migration_registrada;
```

## Preview (opcional)

O banco do Preview (`mfpjqueyefqqzewksqgt`) pode receber o mesmo bloco. Lá o
portão só avisa, não trava o build.

## Se algo der errado

O código no ar não usa as colunas, então não há o que desfazer para o site
voltar a funcionar. Se mesmo assim for preciso recriá-las (o conteúdo antigo
não volta; a informação vigente está em `membros`):

```sql
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "suspenso" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "suspensoAte" TIMESTAMPTZ(3),
ADD COLUMN IF NOT EXISTS "suspensoMotivo" TEXT;
DELETE FROM "_prisma_migrations" WHERE migration_name = '20260924200000_remover_suspensao_legada_usuario';
```
