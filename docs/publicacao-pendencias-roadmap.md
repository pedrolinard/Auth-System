# Roteiro de publicação — branch `pendencias-roadmap`

Passo a passo para levar esta branch a produção sem derrubar nada. **A ordem
importa.** Cada passo diz como verificar antes de seguir.

> **Duas publicações, cada uma com as suas migrations.**
> - **Publicação 1** (passos 0 a 5 abaixo): a `main` em **`98b946c`**, que já
>   está no GitHub. O deploy foi barrado pelo portão em 2026-09-15 porque o
>   passo 1 ainda não tinha rodado. Depois do passo 1, basta refazer o deploy
>   de produção desse commit.
> - **Publicação 2** (seção no fim deste arquivo): os commits da branch
>   **depois** de `98b946c`. As migrations dela só podem rodar depois que a
>   publicação 1 estiver no ar.

Resumo do que sobe: suspensão por organização, cadastro sem enumeração, CSP com
nonce, gestão de aplicações, pente fino (correções de segurança e bugs),
autenticação da aplicação cliente + CORS, SDK, e-mails com marca, endpoints de
saúde. No Django: CSRF endurecido, 400 em `?projeto=abc`, `/api/dominio/saude`.

Segunda rodada (problemas levantados na revisão de segurança, front end e
infra): tolerância de 30 s na reapresentação do refresh token, SDK sem deslogar
abas, client secret conferido sempre que vier, IP do usuário final na
integração pelo servidor, limite de falhas de MFA por conta, sitekey do
Turnstile no pedido de captcha, limpeza agendada (`vercel.json`), monitor de
saúde (GitHub Actions), suporte opcional a `DATABASE_CA_CERT` e
`DATABASE_POOL_MAX`, limite de requisições por usuário no Django e esqueleto de
carregamento no painel. Nenhuma migration a mais, nenhuma variável de ambiente
obrigatória a mais.

Publicação 1: três migrations novas no Next.js, **todas aditivas** (o código atual em produção
ignora as colunas novas): `20260914120000_suspensao_por_membro`,
`20260915090000_motivo_revogacao`, `20260915100000_marca_aplicacao`. Nenhuma
migration nova no Django.

---

## 0. Antes de começar

- [ ] **Tela de projetos:** se ainda não rodou, rode o SQL abaixo (migration
      `tarefas.0002` do Django) no SQL Editor do Supabase. Sem ele, a tela de
      projetos segue em 500 independentemente desta publicação. É idempotente:
      rodar duas vezes não faz mal.

```sql
-- tarefas.0002 (gerado por `manage.py sqlmigrate tarefas 0002`), no schema dominio
ALTER TABLE dominio.tarefas_projeto ADD COLUMN IF NOT EXISTS organizacao_id varchar(40) NULL;
ALTER TABLE dominio.tarefas_tarefa  ADD COLUMN IF NOT EXISTS organizacao_id varchar(40) NULL;
CREATE INDEX IF NOT EXISTS tarefas_projeto_organizacao_id_470fd324      ON dominio.tarefas_projeto (organizacao_id);
CREATE INDEX IF NOT EXISTS tarefas_projeto_organizacao_id_470fd324_like ON dominio.tarefas_projeto (organizacao_id varchar_pattern_ops);
CREATE INDEX IF NOT EXISTS tarefas_tarefa_organizacao_id_3b512317       ON dominio.tarefas_tarefa (organizacao_id);
CREATE INDEX IF NOT EXISTS tarefas_tarefa_organizacao_id_3b512317_like  ON dominio.tarefas_tarefa (organizacao_id varchar_pattern_ops);

-- Dados antigos: cada projeto/tarefa vai pra organização pessoal de quem criou
-- (a mais antiga em que a pessoa é dona). Sem isso, eles somem da tela.
UPDATE dominio.tarefas_projeto p SET organizacao_id = (
  SELECT m."organizacaoId" FROM public.membros m
  JOIN public.organizacoes o ON o.id = m."organizacaoId"
  WHERE m."usuarioId" = p.usuario_id AND m.papel = 'dono'
  ORDER BY o."criadoEm" LIMIT 1
) WHERE p.organizacao_id IS NULL;
UPDATE dominio.tarefas_tarefa t SET organizacao_id = p.organizacao_id
FROM dominio.tarefas_projeto p
WHERE t.projeto_id = p.id AND t.organizacao_id IS NULL;

INSERT INTO dominio.django_migrations (app, name, applied)
SELECT 'tarefas', '0002_projeto_organizacao_id_tarefa_organizacao_id', now()
WHERE NOT EXISTS (
  SELECT 1 FROM dominio.django_migrations WHERE app = 'tarefas' AND name = '0002_projeto_organizacao_id_tarefa_organizacao_id'
);
```
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
- [ ] Vercel → `auth-gateway` → Settings → Cron Jobs lista `/api/cron/limpar-tokens`

> **O workflow Monitor de saúde está DESATIVADO no GitHub** desde 2026-09-15:
> a `main` chegou ao GitHub antes do deploy (barrado pelo portão, faltava o
> passo 1), e ele passaria a falhar e mandar e-mail a cada 15 minutos com a
> produção ainda no código antigo. **Reative depois do passo 4**:
> `gh workflow enable "Monitor de saúde (produção)"` (ou GitHub → Actions →
> Monitor de saúde → Enable workflow).

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
- [ ] Reativar o workflow **Monitor de saúde** (ver o aviso no passo 2) e rodar
      *Run workflow*: os dois passos verdes

## 5. Depois

- [ ] Aponte um monitor externo dedicado para `/api/saude` e `/api/dominio/saude`
      (`docs/operacao.md`, item 5).
- [ ] `DATABASE_CA_CERT`: só seguindo o teste e a ordem de `docs/operacao.md`,
      item 7. Ligar sem testar pode derrubar a conexão com o banco.
- [ ] Usuário do banco separado para o Django (`docs/operacao.md`, item 8).
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

---

# Publicação 2 — commits depois de `98b946c`

**Só depois que a publicação 1 estiver no ar.** Esta seção cresce a cada
commit com migration; confira o commit final antes de rodar.

> **A `main` andou depois de `98b946c` e já foi mesclada nesta branch**
> (2026-09-16): `98bcdd0` gestão de organização e `12eda84` correção da origem
> da aplicação padrão, os dois já em produção e sem migration. O merge não
> acrescenta migration nem variável de ambiente. Nesta publicação, a gestão de
> organização ganha seis eventos de webhook (`membro.removido`,
> `membro.papel_alterado`, `membro.saiu`, `organizacao.renomeada`,
> `organizacao.transferida`, `organizacao.excluida`), excluir uma organização
> passa a apagar os projetos e tarefas dela no Django pela mesma fila da
> exclusão de conta, e uma organização que gerencia aplicações não pode mais
> ser excluída pelo painel (409).

> **`20260921120000_rls_public` entrou depois (2026-09-21)** e mudou o bloco
> da §2.1: se você copiou o SQL antes dessa data, pegue de novo. Ela liga RLS
> em tudo de `public` — defesa em profundidade contra o Data API do Supabase
> (docs/operacao.md, item 11). Não muda o comportamento da aplicação: o Prisma
> conecta como dono das tabelas, e dono contorna RLS.

## 2.1 Migrations no banco de produção (SQL Editor)

Oito migrations, todas aditivas ou sem efeito na aplicação. Rode o bloco
inteiro; ele é idempotente.

```sql
-- 20260916090000_alvo_auditoria
ALTER TABLE "logs_auditoria" ADD COLUMN IF NOT EXISTS "alvo" TEXT;

-- 20260916100000_exclusoes_dominio
CREATE TABLE IF NOT EXISTS "exclusoes_dominio_pendentes" (
    "alvo" TEXT NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "exclusoes_dominio_pendentes_pkey" PRIMARY KEY ("alvo")
);

-- 20260916110000_aplicacao_organizacao_dona
ALTER TABLE "aplicacoes" ADD COLUMN IF NOT EXISTS "organizacaoDonaId" TEXT;
CREATE INDEX IF NOT EXISTS "aplicacoes_organizacaoDonaId_idx" ON "aplicacoes"("organizacaoDonaId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aplicacoes_organizacaoDonaId_fkey') THEN
    ALTER TABLE "aplicacoes" ADD CONSTRAINT "aplicacoes_organizacaoDonaId_fkey" FOREIGN KEY ("organizacaoDonaId") REFERENCES "organizacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 20260916120000_aplicacao_aprovacao
ALTER TABLE "aplicacoes" ADD COLUMN IF NOT EXISTS "aprovada" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "aplicacoes" ADD COLUMN IF NOT EXISTS "desativadaPeloOperador" BOOLEAN NOT NULL DEFAULT false;
UPDATE "aplicacoes" SET "aprovada" = true WHERE "organizacaoDonaId" IS NULL AND "aprovada" = false;

-- 20260916130000_oidc
ALTER TABLE "aplicacoes" ADD COLUMN IF NOT EXISTS "redirectUris" TEXT[] DEFAULT ARRAY[]::TEXT[];
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
CREATE UNIQUE INDEX IF NOT EXISTS "codigos_autorizacao_codigoHash_key" ON "codigos_autorizacao"("codigoHash");
CREATE INDEX IF NOT EXISTS "codigos_autorizacao_expiraEm_idx" ON "codigos_autorizacao"("expiraEm");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'codigos_autorizacao_usuarioId_fkey') THEN
    ALTER TABLE "codigos_autorizacao" ADD CONSTRAINT "codigos_autorizacao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 20260916140000_oidc_cliente_escopo
ALTER TABLE "aplicacoes" ADD COLUMN IF NOT EXISTS "clientePublico" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tokens_atualizacao" ADD COLUMN IF NOT EXISTS "escopoOidc" TEXT;
ALTER TABLE "codigos_autorizacao" ADD COLUMN IF NOT EXISTS "reapresentadoEm" TIMESTAMPTZ(3);

-- 20260916150000_webhooks
CREATE TABLE IF NOT EXISTS "webhooks_aplicacao" (
    "id" TEXT NOT NULL,
    "aplicacaoId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "segredoCifrado" TEXT NOT NULL,
    "eventos" TEXT[],
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "desativadoMotivo" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "webhooks_aplicacao_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "entregas_webhook" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entregueEm" TIMESTAMPTZ(3),
    "desistiuEm" TIMESTAMPTZ(3),
    "ultimoStatus" INTEGER,
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "entregas_webhook_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "webhooks_aplicacao_aplicacaoId_idx" ON "webhooks_aplicacao"("aplicacaoId");
CREATE INDEX IF NOT EXISTS "entregas_webhook_webhookId_criadoEm_idx" ON "entregas_webhook"("webhookId", "criadoEm");
CREATE INDEX IF NOT EXISTS "entregas_webhook_entregueEm_desistiuEm_proximaTentativaEm_idx" ON "entregas_webhook"("entregueEm", "desistiuEm", "proximaTentativaEm");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhooks_aplicacao_aplicacaoId_fkey') THEN
    ALTER TABLE "webhooks_aplicacao" ADD CONSTRAINT "webhooks_aplicacao_aplicacaoId_fkey" FOREIGN KEY ("aplicacaoId") REFERENCES "aplicacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entregas_webhook_webhookId_fkey') THEN
    ALTER TABLE "entregas_webhook" ADD CONSTRAINT "entregas_webhook_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "webhooks_aplicacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 20260921120000_rls_public
-- RLS sem policy em tudo de `public`: o Data API do Supabase expõe esse schema
-- por HTTP com a `anon key`, que é pública por design. Não muda nada pra
-- aplicação: o Prisma conecta como dono das tabelas, e dono contorna RLS.
-- Ver docs/operacao.md, item 11.
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- Registro pro Prisma considerar aplicadas
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, v.checksum, now(), v.nome, NULL, NULL, now(), 1
FROM (VALUES
  ('20260916090000_alvo_auditoria',     'e7cc2f97b097871ffa908b8acf0bfd9bec674757579005ecea93bb8b37e1872a'),
  ('20260916100000_exclusoes_dominio',  'aac1120683a87572a935615be581339da95f3f99ddd8a6e1885a97e561ab5b7d'),
  ('20260916110000_aplicacao_organizacao_dona', '2d30af7b84cd53d201b2d8df64bc2eaa51d46086a3a07b7a3d2b27edd68894c8'),
  ('20260916120000_aplicacao_aprovacao',        'f2e80679c6ad7bb9274f6e052da952f4f611bf023d75c53aee2f5dc2a3a95cc0'),
  ('20260916130000_oidc',                       '85adfabfdd5006add5bbb741f8a1e9d019598c753285d0817234cbe01a69a28b'),
  ('20260916140000_oidc_cliente_escopo',        '2dcaf9a86716f28a6969ef1e96933e8f0a8fc7c5e38d095fe70ae17a393f7271'),
  ('20260916150000_webhooks',                   'e1f693593a141502f2505af06428f6ffc6d01f9163ce0a0bd3eb8c35923eec8f'),
  ('20260921120000_rls_public',                 '34f04309d7a23545a7caef6a21cb7089abf517d7bfdaa81ca77d4c275c9a1400')
) AS v(nome, checksum)
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" p WHERE p.migration_name = v.nome);
```

## 2.2 Publicar

Merge da branch em `main`, push, e deploy do Django como no passo 4.

**Ordem Django × Next nesta publicação:** o Django novo traz
`POST /api/dominio/interno/excluir-dados`. Se o Next subir antes, uma
conta excluída nesse intervalo só deixa o pedido na fila
(`exclusoes_dominio_pendentes`), e o job diário de limpeza reenvia depois do
deploy do Django. Nada se perde; mesmo assim, faça os dois em seguida.

**Tipo de cliente:** toda aplicação existente fica **confidencial** (o padrão).
Se alguma aplicação de teste usa o SDK no navegador, marque "Cliente público"
nela no painel logo depois do deploy — senão a renovação passa a ser recusada.

**Antes do merge, confira a aplicação padrão:** a regra de origem dela mudou.
Antes, lista de origens vazia aceitava qualquer origem; agora aceita a própria
origem do provedor (mesmo host da requisição), chamadas sem `Origin` e as
origens declaradas. O painel no próprio domínio segue funcionando; um front em
OUTRO domínio falando com a aplicação padrão passa a precisar estar nas origens.

**Fila de webhooks:** crie o segredo `CRON_SECRET` no GitHub com o mesmo valor
da produção (`docs/operacao.md`, item 9). Sem ele nada quebra, só as
retentativas ficam mais lentas.

**Verificar:**
- [ ] Monitor de saúde: passo *Fila de webhooks* verde, sem aviso de segredo ausente.
- [ ] `SELECT count(*), max(tentativas) FROM exclusoes_dominio_pendentes;` no dia
      seguinte: fila vazia (ou só itens de hoje).
- [ ] login no painel funciona (a regra de origem da aplicação padrão mudou).
