-- Row Level Security em todas as tabelas de `public`, sem nenhuma policy.
--
-- Por quê: o Supabase liga por padrão o Data API (PostgREST em /rest/v1), que
-- expõe `public` por HTTP autenticado pela `anon key` — uma chave que não é
-- segredo, nasce pra ir embutida em front end. E os defaults do Supabase
-- concedem privilégios em `public` a `anon` e `authenticated`. Sem RLS, essa
-- chave lê `usuarios` (hash de senha, segredo de MFA), `chaves_assinatura` (a
-- chave RS256 que assina todos os tokens), `codigos_backup_mfa`, `passkeys` e
-- `tokens_atualizacao`.
--
-- RLS ligada SEM policy nega tudo — é exatamente o que se quer aqui: ninguém
-- deveria chegar nestas tabelas por HTTP. Quem precisa delas é o Prisma, que
-- conecta como DONO das tabelas, e dono contorna RLS por padrão (só um
-- `FORCE ROW LEVEL SECURITY`, que não está aqui, mudaria isso). Por isso esta
-- migration não altera nada no comportamento da aplicação.
--
-- Desligar o Data API (ou tirar `public` dos "Exposed schemas") continua sendo
-- a correção principal — ver docs/operacao.md, item 11. Esta migration é a
-- defesa em profundidade pro dia em que alguém religar.
--
-- Idempotente: ENABLE numa tabela que já tem RLS é no-op. O laço pega as
-- tabelas que existem AGORA; tabela criada por migration futura nasce sem RLS
-- de novo, e é o teste em tests/lib/rlsPublic.test.ts que não deixa passar.
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
