# Roteiro de publicação — branch `pendencias-roadmap`

Passo a passo para levar esta branch a produção sem derrubar nada. **A ordem
importa.** Cada passo diz como verificar antes de seguir.

Resumo do que sobe: suspensão por organização, cadastro sem enumeração, CSP com
nonce, gestão de aplicações, pente fino (correções de segurança e bugs),
autenticação da aplicação cliente + CORS, SDK, e-mails com marca, endpoints de
saúde. No Django: CSRF endurecido, 400 em `?projeto=abc`, `/api/dominio/saude`.

Três migrations novas no Next.js, **todas aditivas** (o código atual em produção
ignora as colunas novas): `20260914120000_suspensao_por_membro`,
`20260915090000_motivo_revogacao`, `20260915100000_marca_aplicacao`. Nenhuma
migration nova no Django.

---

## 0. Antes de começar

- [ ] **Tela de projetos:** se ainda não rodou, rode o SQL da migration
      `tarefas.0002` do Django (ver `src/data/roadmap.ts`, item
      `django-migration-pendente-producao`). Sem ele, a tela de projetos segue em
      500 independentemente desta publicação.
- [ ] **Não suspenda nem reative ninguém** entre o passo 1 e o passo 4. A
      migration de suspensão copia o estado de `usuarios` para `membros` no
      momento em que roda; o código antigo, ainda no ar, só grava em `usuarios`.

## 1. Aplicar as migrations no banco de produção

**Opção A (preferida), pelo terminal**, com a connection string de produção
(Vercel → auth-gateway → Storage → Supabase → `.env.local`, variável
`SUPABASE_POSTGRES_URL_NON_POOLING`):

```bash
DATABASE_URL="<url de produção>" npx prisma migrate deploy
DATABASE_URL="<url de produção>" npm run migrations:status
```

**Opção B, pelo SQL Editor do Supabase** (projeto `wrqlmjdssiszzkcsvzif`). O
conteúdo abaixo é o dos três `migration.sql`, seguido do registro em
`_prisma_migrations` com o checksum que o Prisma espera (conferido contra o que
o próprio Prisma gravou num banco local). Sem o registro, o portão do build
acusa migration pendente e o deploy não sobe.

```sql
-- 20260914120000_suspensao_por_membro
ALTER TABLE "membros" ADD COLUMN IF NOT EXISTS "suspenso" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "suspensoAte" TIMESTAMPTZ(3),
ADD COLUMN IF NOT EXISTS "suspensoMotivo" TEXT;

UPDATE "membros" AS m
SET "suspenso" = true,
    "suspensoAte" = u."suspensoAte",
    "suspensoMotivo" = u."suspensoMotivo"
FROM "usuarios" AS u
WHERE m."usuarioId" = u."id"
  AND u."suspenso" = true
  AND (u."suspensoAte" IS NULL OR u."suspensoAte" > CURRENT_TIMESTAMP);

-- 20260915090000_motivo_revogacao
ALTER TABLE "tokens_atualizacao" ADD COLUMN IF NOT EXISTS "revogadoMotivo" TEXT;

-- 20260915100000_marca_aplicacao
ALTER TABLE "aplicacoes" ADD COLUMN IF NOT EXISTS "emailRemetente" TEXT,
ADD COLUMN IF NOT EXISTS "urlLinks" TEXT,
ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;

-- Registro pro Prisma considerar as três aplicadas
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, v.checksum, now(), v.nome, NULL, NULL, now(), 1
FROM (VALUES
  ('20260914120000_suspensao_por_membro', 'e2df0cfcfd27a7cfd636921f8d6ea1e81fa1c3ee71e6a9b525e1be318bf90a02'),
  ('20260915090000_motivo_revogacao',     '63e2156d57118c4e56faaa32f7e53cc27cae48e181940d638a5561727f4ef6ea'),
  ('20260915100000_marca_aplicacao',      '8c3b2d1f9624938d94bebc7574d1f713ce154353081f57906c51e06e9b61f3aa')
) AS v(nome, checksum)
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" p WHERE p.migration_name = v.nome);
```

**Verificar:** o site em produção continua funcionando normalmente (login,
cadastro). As colunas novas são ignoradas pelo código atual.

## 2. Publicar o Next.js

Merge da branch em `main` e push. A Vercel faz o deploy sozinha; o portão
`scripts/checar-migrations.mjs` interrompe o build se o passo 1 não tiver sido
feito — nesse caso nada muda em produção, é só voltar ao passo 1.

**Verificar** (as primeiras três dispensam login):

- [ ] `GET /api/saude` → `200 {"status":"ok",...}`
- [ ] header `content-security-policy` de `/login` contém `nonce-` e `strict-dynamic`
- [ ] login e logout com a sua conta; aba **Aplicações** aparece pra conta admin
- [ ] tela de login com MFA mostra "Perdi o autenticador — usar um código de backup"

## 3. Sincronizar suspensões — logo depois do deploy

Cobre a janela entre o passo 1 e o passo 2: quem foi suspenso nela não foi
copiado, e quem foi reativado nela ficou bloqueado na organização.

```sql
UPDATE "membros" AS m
SET "suspenso"       = (u."suspenso" AND (u."suspensoAte" IS NULL OR u."suspensoAte" > now())),
    "suspensoAte"    = CASE WHEN u."suspenso" AND (u."suspensoAte" IS NULL OR u."suspensoAte" > now()) THEN u."suspensoAte" END,
    "suspensoMotivo" = CASE WHEN u."suspenso" AND (u."suspensoAte" IS NULL OR u."suspensoAte" > now()) THEN u."suspensoMotivo" END
FROM "usuarios" AS u
WHERE m."usuarioId" = u."id";
```

> ⚠️ **Rode uma vez, imediatamente após o deploy, e nunca mais.** Depois que
> alguém suspender ou reativar pela versão nova, a suspensão passa a ser por
> organização, e este UPDATE sobrescreveria essas decisões com o estado antigo
> da conta.

Se ninguém suspendeu nem reativou ninguém entre os passos 1 e 2 (o caso mais
provável), este passo não muda nada e pode ser pulado.

## 4. Publicar o Django

```bash
cd django
DATABASE_URL="<url de produção>" DATABASE_SCHEMA=dominio python scripts/checar_migrations.py
npx vercel deploy --prod
```

O script sai com erro se o banco não estiver em dia — é o portão que faltava
(ver `django-migration-pendente-producao` no roadmap).

**Verificar:**

- [ ] `GET https://auth-gateway-django.vercel.app/api/dominio/saude` → `200`
- [ ] tela de **Projetos** no painel carrega e cria um projeto

## 5. Depois

- [ ] Aponte o monitor externo para `/api/saude` e `/api/dominio/saude`
      (`docs/operacao.md`, item 5).
- [ ] Numa publicação **seguinte** (não nesta), remover as colunas legadas
      `usuarios.suspenso/suspensoAte/suspensoMotivo`.

## Se algo der errado

- **Build interrompido pelo portão:** faltou o passo 1. Nada foi alterado em produção.
- **Erro depois do deploy do Next.js:** Vercel → Deployments → *Promote* no
  deploy anterior. As migrations são aditivas: o código anterior funciona com as
  colunas novas, não é preciso desfazê-las.
- **Clientes externos:** ainda não existe nenhum integrado. A exigência de
  origem ou client secret só vale para aplicações clientes; a aplicação padrão
  (o próprio painel) segue a regra anterior.
