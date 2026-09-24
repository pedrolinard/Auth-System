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

**Hoje:** existe um projeto Supabase só para Preview (`mfpjqueyefqqzewksqgt`),
mas o `DATABASE_URL` do Preview **ainda aponta para produção**, e o Preview
não tem os segredos JWT nem a `MFA_ENCRYPTION_KEY`. Resultado: todo deploy de
Preview (inclusive o de cada PR) falha no `next build`, em
`src/lib/token.ts`, com "As variáveis de ambiente JWT_... precisam estar
definidas".

**O que o Preview precisa:**

| | Variáveis |
|---|---|
| Sem elas o build não termina | `JWT_ACCESS_PRIVATE_KEY_B64`, `JWT_ACCESS_PUBLIC_KEY_B64`, os 7 `JWT_*_SECRET`, `MFA_ENCRYPTION_KEY` |
| Sem ela o servidor não sobe | `BASE_URL` |
| Precisa apontar pro banco do Preview | `DATABASE_URL` |
| Opcionais (só avisam) | `DJANGO_SERVICE_URL`, `CRON_SECRET`, Turnstile (as duas chaves ou nenhuma), `PASSKEY_*` (sem elas, passkey não funciona no Preview) |
| **Não** criar no Preview | `RESEND_API_KEY` (um Preview mandaria e-mail de verdade), `DATABASE_CA_CERT` de produção |

Nenhum valor de produção no Preview: um Preview roda código de qualquer
branch, e com a chave de produção um token emitido lá valeria em produção.

**Fazer, nesta ordem:**

1. **Gerar os segredos**, sem que passem pelo terminal:
   ```
   npm run gerar:segredos-preview
   ```
   Escreve `.env.preview` (ignorado pelo git) com as 10 variáveis de segredo
   novas e `BASE_URL`, e **não** imprime nenhum valor. Recusa sobrescrever um
   arquivo que já existe: os segredos dele podem já estar na Vercel e no banco.
2. **Preencher `DATABASE_URL`** no `.env.preview` com a connection string do
   projeto **do Preview** (Supabase → `mfpjqueyefqqzewksqgt` → Connect). Nunca a
   de produção (`wrqlmjdssiszzkcsvzif`).
3. **Preparar o banco do Preview**, com o próprio arquivo:
   ```
   node --env-file=.env.preview node_modules/prisma/build/index.js migrate deploy
   node --env-file=.env.preview scripts/backfill-aplicacoes.mjs
   ```
   O primeiro traz o schema para a versão atual. O segundo cria a aplicação
   padrão e grava a chave de assinatura do Preview cifrada com a
   `MFA_ENCRYPTION_KEY` do arquivo; é idempotente. Com `DATABASE_URL` vazio os
   dois falham, em vez de cair no `.env` local.
4. **Cadastrar na Vercel** (auth-gateway → Settings → Environment Variables),
   marcando **só "Preview"** em cada uma, todas as variáveis do `.env.preview`
   (inclusive o `DATABASE_URL` do banco do Preview). Se o `DATABASE_URL` de
   produção estiver marcado também para Preview, desmarque o Preview nele
   antes. A `MFA_ENCRYPTION_KEY` tem que ser a MESMA do passo 3, senão a chave
   de assinatura no banco fica ilegível.
5. **Guardar o `.env.preview`** num gerenciador de senhas e apagar o arquivo
   local (ou mantê-lo só nesta máquina: ele nunca vai pro git).
6. A cada migration nova: aplicar primeiro no Preview (passo 3, primeiro
   comando), depois em produção.

**Pronto quando:** um Redeploy de Preview sobe (Ready), cadastra e loga, e
nenhuma linha nova aparece no banco de produção.

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

**Antes de tudo, confira o dono das tabelas** — é o único ponto que pode
travar a transação abaixo. O `ALTER ... OWNER` exige que quem executa seja
dono do objeto, e as tabelas de `dominio` foram criadas pelo `migrate` do
Django conectado como `postgres`:

```sql
SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'dominio';
```

Se algum dono não for `postgres`, pare: aquele `ALTER` falha e a transação
volta atrás inteira.

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

## 11. Data API do Supabase (PostgREST) e RLS

**Faça este antes do item 8.** É a mesma preocupação — impedir que um acesso
menos privilegiado leia o `public` — mas com uma exposição muito maior: aqui
não é preciso comprometer o Django, basta uma chave que é pública por
definição.

**O problema.** O Supabase liga por padrão o Data API: um PostgREST em
`https://<ref>.supabase.co/rest/v1/` que expõe o schema `public` por HTTP,
autenticado pela `anon key`. Essa chave **não é segredo** — ela nasce pra ser
embutida em front end. O que impede um estranho de ler é a Row Level Security.
E não há RLS nenhuma neste projeto: nenhuma migration do Prisma liga RLS nem
cria policy. Somado ao default do Supabase, que concede privilégios em `public`
aos papéis `anon` e `authenticated`, o resultado é que a `anon key` lê
`usuarios` (hash de senha, segredo de MFA cifrado), `chaves_assinatura`
(`privadaCifrada`, a chave RS256 que assina todos os tokens),
`codigos_backup_mfa`, `passkeys`, `tokens_atualizacao` e o resto.

**Verificado em 2026-09-21:** o endpoint responde em produção —
`GET https://<ref>.supabase.co/rest/v1/` devolve `401 {"message":"No API key
found in request"}`, ou seja, o PostgREST está no ar, só esperando a chave.
Falta confirmar no painel se a RLS está desligada: **Supabase → Advisors →
Security Advisor** aponta "RLS disabled in public" em 1 clique. Depois da
publicação 2, esse alerta deve sumir sozinho (ver abaixo).

**A correção barata: desligar o Data API.** Este projeto não usa PostgREST pra
nada — não há `supabase-js`, `createClient` nem `SUPABASE_ANON_KEY` em lugar
nenhum do código; Next.js fala com o banco pelo Prisma e o Django pelo psycopg,
os dois pelo pooler. O Data API é superfície de ataque sem contrapartida.
Duas formas, o mesmo efeito:

- **Project Settings → API → desativar o Data API.** Corta tudo.
- **Project Settings → API → tirar `public` de "Exposed schemas".** O
  PostgREST continua de pé mas não enxerga mais nada que importe. Mais fácil
  de explicar pra quem for mexer ali depois: a lista diz na cara o que está
  aberto.

**Defesa em profundidade: RLS ligada mesmo assim.** Se um dia o Data API for
religado (por você ou por um default novo do Supabase), a RLS é o que segura.
Sem policy nenhuma, RLS ligada nega tudo para `anon` e `authenticated`.

Isso **já está versionado**: a migration `20260921120000_rls_public` liga RLS
em todas as tabelas de `public`, e sobe junto com a publicação 2 (o bloco da
§2.1 do roteiro de publicação a inclui). Não é SQL pra rodar na mão.

Como o laço da migration só alcança as tabelas que existiam quando ela rodou,
uma tabela criada por migration futura nasceria sem RLS — e em silêncio. Quem
não deixa é o teste `tests/lib/rlsPublic.test.ts`: ele exige que nenhuma
tabela de `public` esteja sem RLS, então a suíte fica vermelha antes de o
buraco existir em produção.

**Isso não quebra o Prisma nem o Django.** O dono de uma tabela contorna a RLS
por padrão (só um `FORCE ROW LEVEL SECURITY` mudaria isso), e as tabelas de
`public` pertencem ao mesmo papel com que o Prisma conecta. Por isso a ordem
importa: ligue a RLS **antes** de qualquer troca de dono no `public`.

**Conferir:** no Security Advisor, o alerta de RLS desaparece; e, se você
desligou o Data API, `GET https://<ref>.supabase.co/rest/v1/` deixa de
responder.
