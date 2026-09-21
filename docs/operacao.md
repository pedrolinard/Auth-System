# Operação em produção — o que falta para vender

Este documento lista o que **não é código** e precisa existir antes de
cobrar de um cliente. Cada item diz o que fazer, por que importa e como
verificar que ficou pronto.

## 1. Domínio próprio

**Hoje:** `auth-gateway-kappa.vercel.app` e `auth-gateway-django.vercel.app`.

**Por que importa:** o domínio aparece no link de todo e-mail, no RP ID das
passkeys e no `iss` que os clientes vão configurar. Trocar depois quebra as
passkeys já registradas e a configuração de todos os clientes.

**Fazer:**
1. Registrar o domínio (ex.: `auth.suaempresa.com.br`).
2. Vercel → projeto `auth-gateway` → Settings → Domains → adicionar.
3. Atualizar na Vercel (Production): `BASE_URL`, `PASSKEY_RP_ID`,
   `PASSKEY_ORIGIN`.
4. Atualizar a aplicação padrão no painel (`/dashboard/aplicacoes`): origens e RP ID.
5. No projeto Django: `DJANGO_ALLOWED_HOSTS` e `JWT_JWKS_URL` com o domínio novo.

**Pronto quando:** `https://<domínio>/.well-known/jwks.json` responde 200 e
um login com passkey funciona no domínio novo.

## 2. E-mail com domínio verificado

**Hoje:** confira `EMAIL_FROM` em produção. Se for `onboarding@resend.dev`, o
sandbox do Resend só entrega para o dono da conta Resend. O boot agora avisa
isso no log (`[config:produção] EMAIL_FROM ...`).

**Fazer:**
1. Resend → Domains → adicionar o domínio e publicar os registros DNS (SPF, DKIM).
2. Vercel (Production): `EMAIL_FROM="Nome do Produto <seguranca@seudominio>"`.
3. Redeploy.

**Pronto quando:** "Esqueci minha senha" com um e-mail que não é o dono da
conta Resend chega na caixa de entrada, não no spam.

## 3. Planos pagos

| Serviço | Por que o gratuito não serve para cliente pagante |
|---|---|
| Vercel Pro | Uso comercial exige plano pago; limites de função e sem suporte |
| Supabase Pro | Backup diário com retenção, sem pausa por inatividade, recuperação point-in-time |
| Resend | Volume de envio e domínio próprio |
| Rollbar | Retenção e alertas |

## 4. Backup testado

Backup que nunca foi restaurado não é backup.

**Fazer:**
1. Supabase Pro → Database → Backups: confirmar backup diário e ativar PITR.
2. Uma vez por trimestre: restaurar o backup num projeto separado e rodar
   `npx prisma migrate status` contra ele.

**Pronto quando:** existe registro (data e quem fez) de uma restauração bem-sucedida.

## 5. Monitoramento com alerta

**Hoje:** Rollbar captura erros nos dois serviços, mas ninguém recebe alerta.
Depois da publicação, o workflow `.github/workflows/monitor-saude.yml` consulta
os dois endereços abaixo a cada 15 minutos e o GitHub avisa por e-mail quando
falha. É um começo, não o monitor final: o agendamento do GitHub atrasa alguns
minutos em horário de pico e é pausado depois de 60 dias sem atividade no
repositório.

**Fazer:**
1. Rollbar → Notifications: e-mail ou Slack para itens novos de nível `error`.
2. Monitor de disponibilidade externo dedicado (UptimeRobot, Better Stack) apontando
   para dois endereços:
   - `GET /api/saude` (gateway): verifica o banco e a chave de assinatura
   - `GET /api/dominio/saude` (Django): verifica o banco e se há migration pendente.
     Foi uma migration não aplicada que deixou a tela de projetos em 500 em
     produção sem nenhum alerta.
3. Página de status pública ligada a esse monitor.

**Pronto quando:** derrubar o banco de propósito num ambiente de teste gera um
alerta em menos de 5 minutos.

## 6. Ambiente de Preview isolado

**Hoje:** foi criado um projeto Supabase só para Preview
(`mfpjqueyefqqzewksqgt`), com as migrations aplicadas. Mas o `DATABASE_URL`
do Preview **ainda aponta para produção**, e o banco novo está sem a
aplicação padrão e sem chave de assinatura.

**Fazer, nesta ordem:**
1. Rodar `scripts/backfill-aplicacoes.mjs` contra o banco do Preview. Isso cria
   a aplicação padrão e importa um par de chaves **próprio do Preview**, nunca
   o de produção.
2. Vercel (Preview): trocar `DATABASE_URL` para o pooler do banco novo.
3. Vercel (Preview): criar `JWT_CONVITE_ORGANIZACAO_SECRET`, `BASE_URL` e,
   se quiser o Django no Preview, `DJANGO_SERVICE_URL`. Todos os segredos
   devem ser diferentes dos de produção.
4. A cada migration nova: aplicar primeiro no Preview, depois em produção.

**Pronto quando:** um deploy de Preview sobe (Ready), cadastra e loga, e nenhuma
linha nova aparece no banco de produção.

## 7. Conexão com o banco verificando o certificado

**Hoje:** a `DATABASE_URL` dos dois projetos usa `sslmode=no-verify`. A conexão
é cifrada, mas não confere o certificado do servidor: alguém no caminho da rede
entre a Vercel e o Supabase conseguiria se passar pelo banco.

**O código já suporta** a variável `DATABASE_CA_CERT` (Next.js e Django): com
ela, a conexão exige certificado válido e nome de host batendo. Sem ela, nada
muda.

**Testado em 2026-09-16:** o CA `Supabase Root 2021 CA`
(`prod-ca-2021.crt`, SHA-256 `80:70:25:AD:…:CA:FA`, vence em 2031) valida o
pooler `aws-0-us-east-1.pooler.supabase.com` nas portas 5432 e 6543, com o nome
de host batendo (`*.pooler.supabase.com`). Conexão real com o banco do Preview:
Next.js (`configuracaoPool`) e Django (`opcoes_tls`, `sslmode=verify-full`)
conectam com o CA certo e recusam um CA errado. Os passos 1 e 2 abaixo já estão
feitos; falta criar a variável (3 a 5).

**Cuidado:** se o certificado ou o host não baterem, **toda** conexão com o
banco falha e o login sai do ar. Por isso, nesta ordem:

1. Supabase → Project Settings → Database → SSL Configuration → baixar o
   certificado (`prod-ca-2021.crt` ou equivalente).
2. Testar da sua máquina, **com o mesmo host da `DATABASE_URL` de produção**
   (o pooler):
   ```
   psql "host=<host do pooler> port=5432 dbname=postgres user=<usuário> sslmode=verify-full sslrootcert=prod-ca-2021.crt" -c "select 1"
   ```
   Se falhar com erro de certificado ou de hostname, **pare aqui**: o CA não
   vale para o pooler, e ligar a variável derrubaria produção.
3. Se passou: criar `DATABASE_CA_CERT` primeiro no **Preview** (conteúdo do
   arquivo, ou o arquivo em base64), fazer um deploy de Preview e confirmar
   `GET /api/saude` 200.
4. Só então criar em Production, nos dois projetos (`auth-gateway` e
   `auth-gateway-django`), e fazer redeploy dos dois.
5. Conferir `GET /api/saude` e `GET /api/dominio/saude` com 200.

**Rollback:** apagar `DATABASE_CA_CERT` do projeto e fazer redeploy. A conexão
volta ao comportamento anterior (o `sslmode` da URL).

**Pronto quando:** o log de boot do Next.js não mostra mais o aviso
`DATABASE_CA_CERT não definida` e os dois endereços de saúde respondem 200.

## 8. Usuário do banco separado para o Django

**Hoje (a confirmar no painel da Vercel):** se a `DATABASE_URL` do Django usa o
mesmo usuário do Next.js (`postgres`), quem comprometer o Django lê os hashes de
senha, os segredos de MFA e os tokens do schema `public`. A separação atual é só
por schema.

**Fazer** (SQL Editor do Supabase; troque a senha):
```sql
BEGIN;

CREATE ROLE django_dominio LOGIN PASSWORD '<senha-forte>';
GRANT django_dominio TO postgres;  -- sem isso o ALTER ... OWNER abaixo falha
GRANT USAGE, CREATE ON SCHEMA dominio TO django_dominio;
GRANT ALL ON ALL TABLES IN SCHEMA dominio TO django_dominio;
GRANT ALL ON ALL SEQUENCES IN SCHEMA dominio TO django_dominio;
ALTER DEFAULT PRIVILEGES IN SCHEMA dominio GRANT ALL ON TABLES TO django_dominio;
ALTER DEFAULT PRIVILEGES IN SCHEMA dominio GRANT ALL ON SEQUENCES TO django_dominio;
-- migrations futuras alteram tabelas existentes: o dono precisa ser o novo usuário
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'dominio' LOOP
    EXECUTE format('ALTER TABLE dominio.%I OWNER TO django_dominio', t.tablename);
  END LOOP;
  FOR t IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'dominio' LOOP
    EXECUTE format('ALTER SEQUENCE dominio.%I OWNER TO django_dominio', t.sequencename);
  END LOOP;
END $$;

COMMIT;
```

Não conceda nada em `public`: é justamente o que este item existe pra impedir.
O `search_path` do Django é `dominio,public` (`settings.py`), mas um schema que
o papel não enxerga é ignorado em silêncio pelo Postgres — e o `USAGE` que todo
papel já tem em `public` por padrão deixa as funções de extensão resolvíveis sem
dar acesso a **tabela** nenhuma. É esse default-deny que a conferência abaixo
verifica.

**Conferir ANTES de trocar a `DATABASE_URL`** (SQL Editor, na mesma sessão):
```sql
SET ROLE django_dominio;
SELECT count(*) FROM dominio.tarefas_projeto;   -- tem que FUNCIONAR
SELECT count(*) FROM public.usuarios;           -- tem que dar "permission denied"
RESET ROLE;
```
Se a segunda linha devolver um número em vez de erro, **pare**: a separação não
aconteceu e trocar a `DATABASE_URL` não protege nada.
Passando a conferência, teste a conexão de fora com o usuário novo (`psql`,
mesmo host do pooler) antes de mexer na Vercel. Depois, no projeto
`auth-gateway-django`, troque usuário e senha da `DATABASE_URL` — no pooler do
Supabase o usuário fica `django_dominio.<ref do projeto>` — e faça redeploy
(`cd django && npx vercel deploy --prod`).

**Rollback:** voltar a `DATABASE_URL` anterior e fazer redeploy. O papel novo
pode continuar existindo; ele sozinho não muda nada.

**Pronto quando:** `GET /api/dominio/saude` responde 200 com a `DATABASE_URL`
nova e a conferência acima continua dando "permission denied" no `public`.

## 9. Limpeza agendada

Depois da publicação, o `vercel.json` agenda `GET /api/cron/limpar-tokens` uma
vez por dia (06:00 UTC), com o `CRON_SECRET` que já existe em produção. Ele
remove tokens expirados, auditoria com mais de 365 dias, desafios de MFA
vencidos e contadores de limite de tentativas antigos. Antes disso, nada
agendava a rota e essas tabelas só cresciam.

**Pronto quando:** Vercel → projeto `auth-gateway` → Settings → Cron Jobs mostra
a rota, e a execução do dia aparece nos logs com status 200.

**Fila de webhooks.** O plano Hobby da Vercel só agenda uma vez por dia, e uma
entrega de webhook que falhou esperaria até o job seguinte. Por isso o workflow
**Monitor de saúde** (a cada 15 min) também chama `POST /api/cron/webhooks`.
Pra isso, o repositório precisa do segredo `CRON_SECRET` com o **mesmo valor**
da variável de produção: GitHub → Settings → Secrets and variables → Actions →
*New repository secret* (ou `gh secret set CRON_SECRET`). Sem o segredo, o
passo só avisa e a fila anda no job diário e de carona em eventos novos.

**Pronto quando:** a execução do Monitor de saúde mostra o passo *Fila de
webhooks* verde, sem o aviso de segredo ausente.

## 10. Pentest externo

Um sistema de autenticação é exatamente o que o comprador vai perguntar na
due diligence. Contrate um teste de intrusão externo antes do primeiro cliente
relevante. O escopo sugerido está em `docs/seguranca/escopo-pentest.md`.
