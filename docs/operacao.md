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

**Fazer:**
1. Rollbar → Notifications: e-mail ou Slack para itens novos de nível `error`.
2. Monitor de disponibilidade externo (UptimeRobot, Better Stack) apontando
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

## 7. Pentest externo

Um sistema de autenticação é exatamente o que o comprador vai perguntar na
due diligence. Contrate um teste de intrusão externo antes do primeiro cliente
relevante. O escopo sugerido está em `docs/seguranca/escopo-pentest.md`.
