# Sistema de Autenticação 

Gateway de autenticação em Next.js (App Router) que centraliza **cadastro**,
**login** e **geração de tokens** (JWT de acesso + atualização), para ser
consumido por outras aplicações como camada intermediária de identidade.

## Arquitetura

- **Cadastro/Login**: senha com hash `bcrypt` (`src/lib/senha.ts`, máximo de
  72 caracteres — limite de bytes do próprio bcrypt, truncamento silencioso
  além disso). Login roda o `bcrypt.compare` mesmo quando o e-mail não existe
  (contra um hash falso fixo) para não vazar, pelo tempo de resposta, quais
  e-mails têm conta.
- **Tokens**: JWT assinado com `jose` (`src/lib/token.ts`, `algorithms` fixo
  em toda verificação), ambos entregues como **cookies httpOnly**
  (`src/lib/cookies.ts`) — nenhum token fica acessível a JavaScript no
  navegador (mitiga roubo via XSS).
  - **Token de acesso**: curta duração (15 min), assinado com **RS256** (par
    de chaves — a privada só existe no Next.js; a pública pode ser
    compartilhada com outros serviços, como o Django em `django/`, para eles
    validarem o token sem precisar de um segredo compartilhado). Também aceito
    via header `Authorization: Bearer <token>` (fluxo de apps/curl/testes).
  - **Token de atualização**: longa duração (30 dias), assinado com HS256
    (nunca sai do Next.js), com rotação a cada uso e revogação persistida no
    banco (`TokenAtualizacao`). Reapresentar um token **já revogado** pela
    rotação é tratado como reuso (sinal de roubo): revoga toda a família de
    sessões do usuário na hora, não só o token reusado.
- **CSRF explícito**: cookie `csrfToken` (double-submit, não-httpOnly de
  propósito) exigido via header `X-CSRF-Token` em toda mutação autenticada
  por cookie — tanto nas rotas de auth do Next.js quanto nas mutações do
  Django (`comum/autenticacao.py::ProtegidoContraCsrf`), já que o access
  token virou cookie e passou a viajar automaticamente com o navegador.
- **RBAC mínimo**: `Usuario.papel` (`usuario`/`admin`), incluído como claim no
  token de acesso; `GET /api/auth/usuarios` é a rota de exemplo restrita a
  admins.
- **Logs de auditoria**: `LogAuditoria` (`src/lib/auditoria.ts`) registra
  login (sucesso/falha), cadastro e logout com IP e user-agent.
- **Rate limiting**: `src/lib/rateLimit.ts` reaproveita o `LogAuditoria` (sem
  tabela nova) para bloquear com `429` login (5 tentativas erradas/15 min),
  cadastro e recuperação de senha (5 tentativas/hora) do mesmo IP.
- **Banco de dados**: Prisma + Postgres local (`autenticacao`), na mesma
  instância compartilhada com o serviço Django (`django/`), cada um com sua
  própria database (ver seção "Serviço de domínio" abaixo).
- **Proxy** (`src/proxy.ts`, equivalente ao antigo `middleware.ts` a partir do
  Next.js 16): faz checagem otimista de sessão para proteger `/dashboard` e
  redirecionar usuários já autenticados para longe de `/login` e `/cadastro`.
- **Headers de segurança** (`next.config.ts`): `Content-Security-Policy`,
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`, e
  remove o header `X-Powered-By`.
- **Suspensão/exclusão de conta**: admins podem suspender (temporária ou
  permanente) ou excluir permanentemente a conta de outro usuário — ver seção
  "Suspensão e exclusão de contas" abaixo.
- **Logout automático por inatividade**: 5 minutos sem nenhuma interação em
  `/dashboard` derrubam a sessão de verdade e voltam pro login — ver seção
  "Logout automático por inatividade" abaixo.

## Serviço de domínio (Django)

`django/` é um serviço Django REST Framework para as entidades de negócio
(hoje: **projetos e tarefas**, app `tarefas`) que **não tem login próprio** —
ele só valida o token de acesso (RS256) emitido pelo Next.js e usa o claim
`sub` (id do `Usuario`) como identidade do usuário
(`django/comum/autenticacao.py`).

- Alcançado de forma transparente via `next.config.ts` (`rewrites()`
  encaminha `/api/dominio/*` para `DJANGO_SERVICE_URL`), então o browser
  nunca fala com o Django diretamente — mesma origem, sem CORS.
- Postgres **local compartilhado** com o Next.js (mesma instância), em uma
  database própria (`autenticacao_dominio`) — não há FK real entre os dois
  serviços, só o claim `sub` como referência opaca de usuário.
- Telas no Next.js em `/dashboard/projetos` (listar/criar/excluir projetos) e
  `/dashboard/projetos/[id]` (listar/criar tarefas, mudar status, excluir) —
  `src/lib/clienteDominio.ts` centraliza as chamadas, mesmo padrão de
  `clienteAuth.ts`.

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

### Testes automatizados (Django)

```bash
cd django
./venv/Scripts/python.exe -m pytest    # ou apenas `pytest` com o venv ativado
```

Cobre `comum/tests/test_autenticacao.py` (validação do JWT: token válido,
expirado, assinatura adulterada, confusão de algoritmo HS256/RS256, token via
cookie vs. header, claim `papel`) e `tarefas/tests/test_views.py` (CRUD,
isolamento de dados por usuário, e a proteção CSRF de ponta a ponta).

### Testes automatizados (Next.js)

```bash
npm run test
```

Roda com **Vitest contra um servidor `next dev` real** (não mocka
`next/headers`/cookies) — decisão consciente: os bugs reais encontrados nesta
sessão (cache do Turbopack corrompido, 403 em vez de 401 por falta de
`authenticate_header`, `permission_classes` sobrescrevendo o default) só
apareceriam testando o ciclo completo de request/response, não com mocks.

- `tests/globalSetup.ts` sobe `next dev -p 3100` apontando para uma database
  **dedicada e isolada** (`autenticacao_test`, mesma instância Postgres
  local), aplicando as migrations antes da suíte e derrubando a árvore de
  processos no teardown (`taskkill /t /f` no Windows).
- Crie a database antes da primeira execução: `CREATE DATABASE
  autenticacao_test;`.
- 66 testes: `tests/lib/*.test.ts` (unitários — round-trip da criptografia
  AES-256-GCM e geração/consumo/regeneração dos códigos de backup, incluindo
  uma corrida real de duas requisições simultâneas pelo mesmo código) e
  `tests/api/*.test.ts` cobrindo cadastro, login (incluindo o side-channel de
  timing entre e-mail inexistente e senha errada), rotação/reuso de refresh
  token, sessões, MFA (TOTP real via `otpauth` + códigos de backup +
  regeneração), RBAC, recuperação de senha (incluindo o uso único do token),
  verificação de e-mail, CSRF, rate limiting, e suspensão/exclusão de conta
  pelo admin (incluindo a janela entre desafio de MFA e suspensão).

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
| DELETE | `/api/auth/sessoes`        | "Sair de todos os dispositivos" — revoga todas as sessões do usuário     |
| POST   | `/api/auth/mfa/iniciar`    | Gera segredo TOTP + QR code para ativar MFA (rota protegida)             |
| POST   | `/api/auth/mfa/confirmar`  | Confirma o código e ativa o MFA (rota protegida)                         |
| POST   | `/api/auth/mfa/desativar`  | Desativa o MFA mediante código válido (rota protegida); invalida os códigos de backup |
| POST   | `/api/auth/mfa/verificar`  | Conclui o login enviando `mfaToken` (do `/login`) + código de 6 dígitos  |
| POST   | `/api/auth/mfa/backup`     | Conclui o login com um código de backup em vez do TOTP                  |
| POST   | `/api/auth/mfa/backup/regenerar` | Reautentica com um TOTP válido, invalida os códigos antigos e emite 10 novos (rota protegida) |
| POST   | `/api/auth/verificar-email`| Confirma o e-mail a partir do token do link (`emailVerificado = true`)   |
| POST   | `/api/auth/reenviar-verificacao` | Reenvia o e-mail de verificação (rota protegida, rate limited)     |
| POST   | `/api/auth/esqueci-senha`  | Gera o token de redefinição de senha e envia por e-mail                 |
| POST   | `/api/auth/redefinir-senha`| Redefine a senha a partir do token; revoga todas as sessões ativas      |
| GET    | `/api/auth/usuarios`       | Lista usuários — restrito a `papel = admin`                             |
| DELETE | `/api/auth/usuarios/[id]`  | Exclui permanentemente a conta de outro usuário (admin)                 |
| POST   | `/api/auth/usuarios/[id]/suspender` | Suspende a conta de outro usuário, temporária ou permanentemente (admin) |
| POST   | `/api/auth/usuarios/[id]/reativar` | Reativa uma conta suspensa (admin)                                |
| POST   | `/api/cron/limpar-tokens`  | Remove tokens expirados/revogados antigos; exige `Authorization: Bearer CRON_SECRET` |

As rotas `/api/dominio/*` (`/api/dominio/projetos`, `/api/dominio/tarefas`)
não ficam em `src/app/api/` — são servidas pelo serviço Django
(`django/tarefas/urls.py`) e só chegam até ele via rewrite (seção "Serviço de
domínio" acima).

## Como rodar

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

Antes de rodar, copie `.env.example` para `.env`, gere o par de chaves RS256
do token de acesso (`npm run gerar:chaves-rs256`) e defina segredos fortes
para `JWT_REFRESH_SECRET`, `JWT_MFA_SECRET`, `JWT_VERIFICACAO_EMAIL_SECRET`,
`JWT_REDEFINICAO_SENHA_SECRET`, `MFA_ENCRYPTION_KEY` e `CRON_SECRET`.

## Banco de dados

Postgres local (instalado via `choco install postgresql` ou equivalente),
com duas databases na mesma instância: `autenticacao` (Next.js/Prisma) e
`autenticacao_dominio` (Django). Crie ambas antes do primeiro `migrate`:

```sql
CREATE DATABASE autenticacao;
CREATE DATABASE autenticacao_dominio;
```

```bash
npx prisma migrate dev   # aplica as migrações do lado Next.js
npx prisma studio        # inspeciona os dados
```

## Segurança em produção

### Gerar segredos fortes

O token de acesso usa um par de chaves RS256 (`npm run gerar:chaves-rs256`,
que preenche `JWT_ACCESS_PRIVATE_KEY_B64`/`JWT_ACCESS_PUBLIC_KEY_B64`).

Os demais `*_SECRET` do `.env` precisam de um valor aleatório e único — nunca
reuse o mesmo valor entre `JWT_REFRESH_SECRET`, `JWT_MFA_SECRET`,
`JWT_VERIFICACAO_EMAIL_SECRET`, `JWT_REDEFINICAO_SENHA_SECRET` e
`MFA_ENCRYPTION_KEY`, pois eles isolam os tipos de token/dado entre si (o
`MFA_ENCRYPTION_KEY` em especial: é usado para **cifrar dados em repouso**
no banco, não para assinar tokens efêmeros — ver seção "Verificação em duas
etapas" abaixo).
Gere cada um separadamente (funciona em qualquer SO, sem depender do
`openssl` estar instalado):

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

`Usuario.mfaSecret` é cifrado em repouso (`src/lib/cripto.ts`, AES-256-GCM,
formato `iv:authTag:ciphertext` em base64) com uma chave própria
(`MFA_ENCRYPTION_KEY`, 32 bytes em base64, distinta dos segredos JWT) — se o
banco vazar, os segredos TOTP não vazam junto. Gere com:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

#### Códigos de backup (recovery codes)

`POST /api/auth/mfa/confirmar` também emite **10 códigos de backup** (formato
`XXXXX-XXXXX`, alfabeto A-Z/2-9 sem caracteres ambíguos — `O`, `0`, `I`, `1`,
`L` — ~49,5 bits de entropia cada) na mesma resposta da ativação: é a
**única vez** que aparecem em texto puro. No banco (`CodigoBackupMfa`) só o
hash SHA-256 fica salvo (mesmo padrão do `TokenAtualizacao`); cada código é
de uso único (`usadoEm` marcado atomicamente no consumo, à prova de duas
requisições concorrentes tentando o mesmo código).

- `POST /api/auth/mfa/backup` — alternativa a `/mfa/verificar` quando o
  usuário perdeu o autenticador: mesmo desafio (`mfaToken`), rate limit
  próprio (`mfa_backup_falha`), recheca suspensão antes de concluir. Retorna
  `codigosBackupRestantes` na resposta.
- `POST /api/auth/mfa/backup/regenerar` — exige **reautenticação** (um TOTP
  válido do próprio segredo, não basta a sessão atual) para invalidar todos
  os códigos antigos e emitir 10 novos — sem essa exigência, uma sessão
  sequestrada poderia rotacionar os códigos silenciosamente.
- Desativar o MFA (`/mfa/desativar`) invalida todos os códigos de backup do
  usuário — não faz sentido manter recovery codes de um segundo fator que
  não existe mais.
- `GET /api/auth/me` inclui `codigosBackupRestantes` (número de códigos ainda
  não usados, ou `null` se o MFA não está ativo) para a UI avisar quando o
  estoque estiver acabando.

### Verificação de e-mail

`POST /api/auth/cadastro` gera um token stateless (mesmo padrão do desafio
MFA, 1 dia de validade) e envia o link de verificação por e-mail de verdade
via **Resend** (`src/lib/email.ts`). O usuário abre `/verificar-email?token=...`,
que chama `POST /api/auth/verificar-email` e marca `Usuario.emailVerificado = true`.

Configuração: `RESEND_API_KEY` (gerada em https://resend.com/api-keys) e
`EMAIL_FROM` (remetente). Sem `RESEND_API_KEY` definida, cai de volta pro
comportamento antigo — o link só é logado no console (útil pra dev local sem
depender de uma conta Resend). O remetente padrão (`onboarding@resend.dev`)
é o domínio de teste do Resend: funciona sem configurar DNS, mas só entrega
pro e-mail cadastrado na própria conta Resend (modo sandbox) — para enviar
para qualquer destinatário (ex. um usuário real se cadastrando), é preciso
verificar um domínio próprio no Resend e apontar `EMAIL_FROM` para ele.

Contas que não verificaram o e-mail veem um botão "Reenviar e-mail de
verificação" no dashboard (`POST /api/auth/reenviar-verificacao`, autenticado,
rate limited a 3 tentativas/hora por IP) — cobre o caso de contas criadas
antes do envio real existir, ou de o e-mail original ter se perdido.

### RBAC mínimo

`Usuario.papel` (`"usuario"` ou `"admin"`, default `"usuario"`) vai no claim
`papel` do token de acesso — tanto o Next.js quanto o Django
(`UsuarioRemoto.papel`) conseguem checar sem consultar o banco de novo. Não
existe UI para promover um usuário a admin ainda; faça direto no banco:

```sql
UPDATE usuarios SET papel = 'admin' WHERE email = 'seu-email@exemplo.com';
```

### Suspensão e exclusão de contas (admin)

Em `/dashboard/usuarios`, admins podem **suspender** (1/7/30 dias ou
permanente, com motivo opcional) ou **excluir permanentemente** a conta de
qualquer outro usuário — um admin não consegue suspender/excluir a própria
conta.

- `POST /api/auth/usuarios/[id]/suspender` (`{ dias?, motivo? }` — sem `dias`
  = permanente) e `POST /api/auth/usuarios/[id]/reativar`.
- `DELETE /api/auth/usuarios/[id]` — irreversível; `TokenAtualizacao` é
  removido em cascata, `LogAuditoria` não (o histórico sobrevive à exclusão).
- Suspender **revoga todas as sessões ativas na hora** (mesma lógica de "sair
  de todos os dispositivos") e bloqueia `POST /api/auth/login` com 403 daí
  em diante. O access token já emitido (até 15 min) continua valendo até
  expirar naturalmente — mesmo trade-off já aceito no resto do sistema.
- Suspensão temporária expirada (`suspensoAte` no passado) é tratada como
  inativa automaticamente, sem precisar de reativação manual nem job de
  limpeza.
- A checagem de suspensão roda tanto em `POST /api/auth/login` quanto em
  `POST /api/auth/mfa/verificar` — cobre o caso de um admin suspender a conta
  durante os até 5 min entre o desafio de MFA e a confirmação do código.

### Logout automático por inatividade

`src/components/MonitorInatividade.tsx`, montado em todas as telas de
`/dashboard` via `src/app/dashboard/layout.tsx`, desloga automaticamente após
**5 minutos sem nenhuma interação** (mouse, teclado, scroll, toque ou clique).
Não é um redirecionamento só do lado do cliente: ele chama a mesma função
`sair()` usada pelo botão de logout manual, que bate em
`POST /api/auth/logout` e **revoga a sessão de verdade no banco**
(`TokenAtualizacao`) antes de mandar o usuário de volta pro `/login` — um
token de acesso já emitido não continuaria "logado" só porque a aba ficou
parada.

### Sair de todos os dispositivos

`DELETE /api/auth/sessoes` revoga todas as sessões (tokens de atualização)
ativas do usuário de uma vez — diferente de `DELETE /api/auth/sessoes/[id]`,
que revoga só uma. Como o token de acesso é um JWT stateless de vida curta
(15 min), outros dispositivos continuam "logados" com o token de acesso que
já tinham até ele expirar naturalmente — só a **renovação** (refresh) é
bloqueada imediatamente. Esse é o trade-off inerente a JWT sem blocklist, não
uma falha da funcionalidade.

### Recuperação de senha

Token JWT com segredo próprio (`JWT_REDEFINICAO_SENHA_SECRET`, expira em
**1h**): `POST /api/auth/esqueci-senha` (`/esqueci-senha` na UI) gera o
token e envia o link por e-mail de verdade via Resend
(`enviarEmailRedefinicaoSenha` em `src/lib/email.ts`, mesma
configuração/limitação de sandbox do e-mail de verificação — ver seção
"Verificação de e-mail" acima) — **sempre responde com sucesso genérico**,
exista ou não o e-mail, pra não vazar quais contas existem.

`POST /api/auth/redefinir-senha` (`/redefinir-senha?token=...` na UI) valida
o token, atualiza a senha e **revoga todas as sessões ativas** do usuário (a
senha pode ter sido comprometida, então todo acesso existente cai). O token
em si é um JWT stateless válido pela hora inteira — sem mais nada, o mesmo
link daria pra usar mais de uma vez na janela. `Usuario.senhaAlteradaEm`
(única coluna nova) marca o instante da última troca; qualquer token de
redefinição com `iat` anterior a esse instante é rejeitado, o que torna o
próprio link de uso único (o uso atual sempre invalida ele mesmo para uma
segunda tentativa) sem precisar de uma tabela de tokens usados.

### Rate limiting / proteção contra força bruta

`src/lib/rateLimit.ts` reaproveita `LogAuditoria` (sem tabela nova): conta
quantos eventos de um tipo vieram do mesmo IP (extraído de
`X-Forwarded-For`/`X-Real-IP`) dentro de uma janela de tempo e responde `429`
antes mesmo de processar a requisição. Aplicado em login (5 tentativas
erradas/15 min), cadastro e recuperação de senha (5 tentativas/hora cada).
**Atenção**: `X-Forwarded-For` só é confiável atrás de um proxy que
efetivamente o sobrescreve (Vercel faz isso em produção) — sem um proxy
confiável na frente, é possível forjar o header pra burlar o limite ou pra
derrubar outra pessoa nele. Trade-off documentado, não escondido.

### Headers de segurança HTTP

`next.config.ts` define, pra toda rota: `Content-Security-Policy` (default-src
'self', com `unsafe-inline` em script/style — um CSP totalmente estrito exigiria
nonce por requisição via `proxy.ts`, mais invasivo; ver comentário no arquivo),
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, `Permissions-Policy` (bloqueia câmera/
microfone/geolocalização) e `Strict-Transport-Security`. `poweredByHeader:
false` remove o `X-Powered-By: Next.js`. Em desenvolvimento, o CSP libera
`unsafe-eval` porque o React usa `eval()` pra reconstruir call stacks em modo
dev — nunca em produção, então isso não enfraquece o CSP real.

O serviço Django não expõe `/admin/` — o app não tem model de `Usuario` nem
login próprio do Django (só a classe de autenticação JWT customizada), então
o painel de admin padrão ficaria exposto sem nenhuma função real.

### Proteção CSRF explícita

Padrão *double-submit cookie*: `src/lib/csrf.ts` (Next.js) e
`comum/autenticacao.py::ProtegidoContraCsrf` (Django) exigem que o header
`X-CSRF-Token` bata com o valor do cookie `csrfToken` (não-httpOnly, o
cliente lê via `document.cookie`) em toda mutação — exceto quando a
requisição não tem esse cookie (cliente não-navegador, ex. Bearer/curl, onde
CSRF não se aplica). Ficou necessário de verdade a partir do momento em que
o access token virou cookie: antes, com o token só em `sessionStorage`, um
site atacante não conseguia forjar o header `Authorization` sozinho. A
comparação em si usa `crypto.timingSafeEqual` (não `===`), para não vazar
por timing quantos caracteres do token o atacante já acertou.

### Limpeza de tokens expirados

A tabela `tokens_atualizacao` acumula um registro por login/renovação. Rode a
limpeza periodicamente (cron do SO, Task Scheduler do Windows, Vercel Cron
etc.) apontando para a rota protegida por `CRON_SECRET`:

```bash
npm run limpeza:tokens
```

O script lê `BASE_URL` e `CRON_SECRET` do `.env` (por padrão usa
`http://localhost:3000`) e chama `POST /api/cron/limpar-tokens`.

### Deploy (Vercel)

O sistema está em produção como dois projetos Vercel separados, cada um com
seu próprio Postgres provisionado via Marketplace (Neon, plano free) e
segredos próprios (gerados exclusivamente para produção, diferentes dos do
`.env` local):

| Projeto | Root Directory | URL |
| ------- | --------------- | --- |
| `auth-gateway` (Next.js) | `.` | https://auth-gateway-kappa.vercel.app |
| `auth-gateway-django` (Django) | `django/` | https://auth-gateway-django.vercel.app |

O projeto Django detecta Python/Fluid Compute automaticamente a partir do
`requirements.txt`; `django/vercel.json` declara `config/wsgi.py` como
entrypoint da function (necessário porque `manage.py` não está na raiz do
projeto Vercel). Variáveis configuradas em cada projeto:

- **`auth-gateway`**: `JWT_ACCESS_PRIVATE_KEY_B64`, `JWT_ACCESS_PUBLIC_KEY_B64`,
  `JWT_REFRESH_SECRET`, `JWT_MFA_SECRET`, `JWT_VERIFICACAO_EMAIL_SECRET`,
  `JWT_REDEFINICAO_SENHA_SECRET`, `MFA_ENCRYPTION_KEY`, `CRON_SECRET`,
  `BASE_URL`, `DJANGO_SERVICE_URL` (aponta para a URL de produção do projeto
  Django), além de `DATABASE_URL` (injetada automaticamente pela integração
  Neon).
- **`auth-gateway-django`**: `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`
  (`auth-gateway-django.vercel.app` — o domínio exato de produção, não um
  wildcard `*.vercel.app`; ajustar se um domínio próprio for configurado),
  `JWT_ACCESS_PUBLIC_KEY_B64` (mesma chave pública do projeto Next.js, para
  validar o mesmo token), além de `DATABASE_URL` própria (Neon separado do
  Next.js — sem FK entre os dois bancos, só o claim `sub` do JWT).

**Atenção**: só o projeto `auth-gateway` (Next.js) tem deploy automático via
GitHub — cada push na `main` dispara build/deploy sozinho, e o próprio
`npm run build` roda `prisma migrate deploy` antes do `next build` (script
`build` do `package.json`), então toda migração pendente é aplicada na
`DATABASE_URL` de produção automaticamente a cada deploy — **isso já
faltou** uma vez (3 migrações acumuladas sem rodar, quebrando rotas que
dependiam das colunas/tabela novas) antes desse ajuste. O projeto
`auth-gateway-django` **não** está conectado ao Git; mudanças em `django/`
exigem `cd django && npx vercel deploy --prod` manualmente depois do push, e
mudanças de schema exigem aplicar a migration na `DATABASE_URL` de produção
antes (`manage.py migrate`) — esse lado não roda migration sozinho no
deploy.

O projeto também teve "Vercel Authentication" (proteção SSO de deployment)
desativada — com ela ligada, qualquer visitante sem login no time Vercel
recebia 401 antes mesmo de chegar no Next.js, inviabilizando o uso público
do sistema.

Para reproduzir ou atualizar o deploy manualmente:

```bash
npx vercel link --project auth-gateway         # raiz do repo
npx vercel install neon                         # provisiona/conecta o Postgres
npx vercel env add <NOME_DA_VARIAVEL> production
npx vercel env pull .env.production.local --environment=production
npx prisma migrate deploy                       # com a DATABASE_URL de produção
npx vercel deploy --prod

cd django
npx vercel link --project auth-gateway-django
npx vercel install neon
# repetir env add/pull + manage.py migrate + vercel deploy --prod
```
