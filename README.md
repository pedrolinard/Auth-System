# Autenticação — Sistema de Autenticação Intermediária

Gateway de autenticação em Next.js (App Router) que centraliza **cadastro**,
**login** e **geração de tokens** (JWT de acesso + atualização), para ser
consumido por outras aplicações como camada intermediária de identidade.

## Arquitetura

- **Cadastro/Login**: senha com hash `bcrypt` (`src/lib/senha.ts`).
- **Tokens**: JWT assinado com `jose` (`src/lib/token.ts`)
  - **Token de acesso**: curta duração (15 min), assinado com **RS256** (par
    de chaves — a privada só existe no Next.js; a pública pode ser
    compartilhada com outros serviços, como o Django em `django/`, para eles
    validarem o token sem precisar de um segredo compartilhado). Enviado no
    header `Authorization: Bearer <token>` para chamar rotas protegidas.
  - **Token de atualização**: longa duração (30 dias), assinado com HS256
    (nunca sai do Next.js), com rotação a cada uso e revogação persistida no
    banco (`TokenAtualizacao`), guardado também como cookie `httpOnly`.
- **Banco de dados**: Prisma + SQLite em desenvolvimento (`prisma/dev.db`),
  pronto para trocar para Postgres em produção só alterando `DATABASE_URL`
  e o `provider` do datasource.
- **Proxy** (`src/proxy.ts`, equivalente ao antigo `middleware.ts` a partir do
  Next.js 16): faz checagem otimista de sessão para proteger `/dashboard` e
  redirecionar usuários já autenticados para longe de `/login` e `/cadastro`.

## Serviço de domínio (Django)

`django/` é um serviço Django REST Framework de exemplo que **não tem login
próprio** — ele só valida o token de acesso (RS256) emitido pelo Next.js e usa
o claim `sub` (id do `Usuario`) como identidade do usuário
(`django/comum/autenticacao.py`). O app `exemplo` (model `Item`) existe só
para provar essa integração ponta a ponta; entidades de negócio reais seguem
o mesmo padrão depois.

- Alcançado de forma transparente via `next.config.ts` (`rewrites()`
  encaminha `/api/dominio/*` para `DJANGO_SERVICE_URL`), então o browser
  nunca fala com o Django diretamente — mesma origem, sem CORS.
- Banco próprio (SQLite em dev, Postgres em produção), desacoplado do banco
  do Next.js — não há FK real entre os dois serviços.

Para rodar localmente:

```bash
cd django
python -m venv venv
./venv/Scripts/activate   # ou source venv/bin/activate no Linux/Mac
pip install -r requirements.txt
cp .env.example .env      # copie JWT_ACCESS_PUBLIC_KEY_B64 do .env da raiz
python manage.py migrate
python manage.py runserver 8000
```

## Rotas de API

| Método | Rota                       | Descrição                                                              |
| ------ | -------------------------- | ------------------------------------------------------------------------ |
| POST   | `/api/auth/cadastro`       | Cria um novo usuário                                                     |
| POST   | `/api/auth/login`          | Autentica; retorna tokens ou `{ mfaObrigatorio: true }` se MFA ativado   |
| POST   | `/api/auth/atualizar`      | Rotaciona o token de atualização e emite novo acesso                     |
| POST   | `/api/auth/logout`         | Revoga o token de atualização atual                                      |
| GET    | `/api/auth/me`             | Retorna o usuário autenticado (rota protegida, exemplo)                  |
| GET    | `/api/auth/sessoes`        | Lista as sessões (tokens de atualização) ativas do usuário autenticado   |
| DELETE | `/api/auth/sessoes/[id]`   | Revoga uma sessão específica do usuário autenticado                      |
| POST   | `/api/auth/mfa/iniciar`    | Gera segredo TOTP + QR code para ativar MFA (rota protegida)             |
| POST   | `/api/auth/mfa/confirmar`  | Confirma o código e ativa o MFA (rota protegida)                         |
| POST   | `/api/auth/mfa/desativar`  | Desativa o MFA mediante código válido (rota protegida)                   |
| POST   | `/api/auth/mfa/verificar`  | Conclui o login enviando `mfaToken` (do `/login`) + código de 6 dígitos  |
| POST   | `/api/cron/limpar-tokens`  | Remove tokens expirados/revogados antigos; exige `Authorization: Bearer CRON_SECRET` |

As rotas `/api/dominio/*` (ex.: `/api/dominio/itens`) não ficam em
`src/app/api/` — são servidas pelo serviço Django (`django/exemplo/urls.py`)
e só chegam até ele via rewrite (seção "Serviço de domínio" acima).

## Como rodar

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

Antes de rodar, copie `.env.example` para `.env`, gere o par de chaves RS256
do token de acesso (`npm run gerar:chaves-rs256`) e defina segredos fortes
para `JWT_REFRESH_SECRET`, `JWT_MFA_SECRET` e `CRON_SECRET`.

## Banco de dados

```bash
npx prisma migrate dev   # aplica as migrações
npx prisma studio        # inspeciona os dados
```

## Segurança em produção

### Gerar segredos fortes

O token de acesso usa um par de chaves RS256 (`npm run gerar:chaves-rs256`,
que preenche `JWT_ACCESS_PRIVATE_KEY_B64`/`JWT_ACCESS_PUBLIC_KEY_B64`).

Os demais `*_SECRET` do `.env` precisam de um valor aleatório e único — nunca
reuse o mesmo valor entre `JWT_REFRESH_SECRET` e `JWT_MFA_SECRET`, pois eles
isolam os tipos de token entre si. Gere cada um separadamente (funciona em
qualquer SO, sem depender do `openssl` estar instalado):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Para o `CRON_SECRET` (mais curto, só precisa ser imprevisível):

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

### Verificação em duas etapas (MFA/TOTP)

Fluxo: `POST /api/auth/mfa/iniciar` (autenticado) devolve um QR code — o
usuário escaneia com Google Authenticator/Authy/1Password e confirma com um
código em `POST /api/auth/mfa/confirmar`. A partir daí, `POST /api/auth/login`
passa a responder `{ mfaObrigatorio: true, mfaToken }` em vez dos tokens
normais; o cliente completa o login em `POST /api/auth/mfa/verificar` com
`{ mfaToken, codigo }`.

### Limpeza de tokens expirados

A tabela `tokens_atualizacao` acumula um registro por login/renovação. Rode a
limpeza periodicamente (cron do SO, Task Scheduler do Windows, Vercel Cron
etc.) apontando para a rota protegida por `CRON_SECRET`:

```bash
npm run limpeza:tokens
```

O script lê `BASE_URL` e `CRON_SECRET` do `.env` (por padrão usa
`http://localhost:3000`) e chama `POST /api/cron/limpar-tokens`.

### Deploy do serviço Django (Vercel)

Criar um segundo projeto Vercel com Root Directory `django/` — a detecção de
Python/Fluid Compute reconhece o `requirements.txt` automaticamente. Nesse
projeto, configurar `DJANGO_SECRET_KEY`, `DATABASE_URL` (Postgres dedicado),
`DJANGO_ALLOWED_HOSTS` e `JWT_ACCESS_PUBLIC_KEY_B64` (copiado do projeto
Next.js). No projeto Next.js, apontar `DJANGO_SERVICE_URL` para a URL de
produção do projeto Django.
