# Autenticação — Sistema de Autenticação Intermediária

Gateway de autenticação em Next.js (App Router) que centraliza **cadastro**,
**login** e **geração de tokens** (JWT de acesso + atualização), para ser
consumido por outras aplicações como camada intermediária de identidade.

## Arquitetura

- **Cadastro/Login**: senha com hash `bcrypt` (`src/lib/senha.ts`).
- **Tokens**: JWT assinado com `jose` (`src/lib/token.ts`)
  - **Token de acesso**: curta duração (15 min), enviado no header
    `Authorization: Bearer <token>` para chamar rotas protegidas.
  - **Token de atualização**: longa duração (30 dias), com rotação a cada uso
    e revogação persistida no banco (`TokenAtualizacao`), guardado também
    como cookie `httpOnly`.
- **Banco de dados**: Prisma + SQLite em desenvolvimento (`prisma/dev.db`),
  pronto para trocar para Postgres em produção só alterando `DATABASE_URL`
  e o `provider` do datasource.
- **Proxy** (`src/proxy.ts`, equivalente ao antigo `middleware.ts` a partir do
  Next.js 16): faz checagem otimista de sessão para proteger `/dashboard` e
  redirecionar usuários já autenticados para longe de `/login` e `/cadastro`.

## Rotas de API

| Método | Rota                  | Descrição                                             |
| ------ | --------------------- | ------------------------------------------------------ |
| POST   | `/api/auth/cadastro`  | Cria um novo usuário                                    |
| POST   | `/api/auth/login`     | Autentica e retorna `tokenAcesso` + `tokenAtualizacao`  |
| POST   | `/api/auth/atualizar` | Rotaciona o token de atualização e emite novo acesso    |
| POST   | `/api/auth/logout`    | Revoga o token de atualização atual                     |
| GET    | `/api/auth/me`        | Retorna o usuário autenticado (rota protegida, exemplo) |

## Como rodar

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

Antes de rodar, copie `.env.example` para `.env` e defina segredos fortes
para `JWT_ACCESS_SECRET` e `JWT_REFRESH_SECRET` (ex.: `openssl rand -base64 32`).

## Banco de dados

```bash
npx prisma migrate dev   # aplica as migrações
npx prisma studio        # inspeciona os dados
```
