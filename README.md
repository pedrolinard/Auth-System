# Sistema de Autenticação 

Gateway de autenticação em Next.js (App Router) que centraliza **cadastro**,
**login** e **geração de tokens** (JWT de acesso + atualização), para ser
consumido por outras aplicações como camada intermediária de identidade.

## Arquitetura

- **Cadastro/Login**: senha com hash `bcrypt` (`src/lib/senha.ts`, máximo de
  72 **bytes UTF-8** — o bcrypt trunca em silêncio além disso; a validação
  conta bytes, não caracteres, senão uma senha curta com acentos/emoji
  passaria e seria truncada mesmo assim). Login roda o `bcrypt.compare`
  mesmo quando o e-mail não existe
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
  tabela nova) para bloquear com `429` login (20 tentativas erradas/15 min
  por IP — ver nota sobre IP compartilhado abaixo — ou 20/15 min por conta,
  o que estourar primeiro), cadastro e recuperação de senha (5 tentativas/
  hora) do mesmo IP.
- **CAPTCHA (Cloudflare Turnstile)**: fricção progressiva antes do bloqueio
  duro em login (5 falhas do mesmo IP) e cadastro (3 falhas do mesmo IP) —
  passa a exigir um token válido do Turnstile além das credenciais (ver
  seção própria abaixo).
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
- **Sessões ativas com contexto**: a lista de sessões no dashboard mostra tipo
  de dispositivo (desktop/tablet/mobile) e localização aproximada (cidade/UF/
  país) de cada uma — ver seção "Tipo de dispositivo e localização nas
  sessões ativas" abaixo.
- **Limite de sessões simultâneas**: no máximo 5 sessões ativas por usuário —
  ver seção "Limite de sessões simultâneas" abaixo.
- **Senha vazada (Have I Been Pwned)**: cadastro e troca de senha recusam
  senhas já conhecidas em vazamentos reais — ver seção "Senha vazada" abaixo.
- **Troca de senha estando logado**: `PUT /api/auth/senha` — ver seção
  "Troca de senha estando logado" abaixo.
- **Observabilidade (Rollbar)**: erros inesperados de servidor e de cliente
  são capturados automaticamente (não só logados no console) — ver seção
  "Observabilidade (Rollbar)" abaixo.
- **"Lembrar este dispositivo"**: pula o desafio de MFA por 30 dias num
  navegador já verificado — ver seção "Lembrar este dispositivo" abaixo.
- **Alterar e-mail**: confirmação em duas etapas (link no e-mail novo) — ver
  seção "Alterar e-mail" abaixo.
- **Painel de auditoria para admins**: `/dashboard/auditoria` consulta os
  logs de `LogAuditoria` sem acessar o banco direto — ver seção "Painel de
  auditoria" abaixo.
- **Detecção de "viagem impossível"**: alerta por e-mail quando duas sessões
  aparecem em países diferentes num intervalo curto demais — ver seção
  "Viagem impossível" abaixo.

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
npm run test       # Vitest — rotas de API
npm run test:e2e   # Playwright — UI de verdade no navegador
```

**Vitest** roda contra um **servidor `next dev` real** (não mocka
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
- `vitest.config.ts` exclui `tests-e2e/**` do escopo do Vitest — sem isso, o
  glob default (`**/*.spec.ts`) também casaria com as specs do Playwright
  abaixo, que usam a API `test.describe()` do Playwright, não a do Vitest.
- 129 testes: `tests/lib/*.test.ts` (unitários — round-trip da criptografia
  AES-256-GCM incluindo o versionamento do formato cifrado e a rotação de
  `MFA_ENCRYPTION_KEY`, e geração/consumo/regeneração dos códigos de backup,
  incluindo uma corrida real de duas requisições simultâneas pelo mesmo
  código) e `tests/api/*.test.ts` cobrindo cadastro, login (incluindo o
  side-channel de timing entre e-mail inexistente e senha errada e a
  detecção de "viagem impossível"), rotação/reuso de refresh token, sessões
  (incluindo o limite de 5 simultâneas), MFA (TOTP real via `otpauth` +
  bloqueio de replay/código expirado no login + códigos de backup +
  regeneração + "lembrar este dispositivo"), RBAC, troca de senha (logado e
  via e-mail, incluindo senha vazada e o uso único do token de
  redefinição), alteração de e-mail (confirmação em duas etapas), painel de
  auditoria (admin), verificação de e-mail, CSRF, rate limiting, e
  suspensão/exclusão de conta pelo admin (incluindo a janela entre desafio
  de MFA e suspensão).

**Playwright** dirige um Chromium de verdade contra o **próprio app renderizado**
(`playwright.config.ts`, porta 3200 — diferente da 3100 do Vitest, pra rodar
os dois em paralelo sem os servidores `next dev` colidirem), cobrindo o que a
suíte de API não alcança: formulários, navegação, e o que o usuário
efetivamente vê na tela (`tests-e2e/*.spec.ts`).

- Mesma database `autenticacao_test` do Vitest — os dois tipos de teste nunca
  rodam ao mesmo tempo no fluxo normal, então compartilhar não gera conflito.
- `tests-e2e/global-setup.ts` aplica as migrations antes da suíte;
  `tests-e2e/helpers.ts` cria/apaga usuários de teste direto via `pg` (não
  `@/lib/db`/Prisma — o guard `server-only` e o `import.meta` do client
  gerado não funcionam fora do bundler do Next.js).

### CI (GitHub Actions)

`.github/workflows/ci.yml` roda em todo PR e push na `main` — antes disso,
nada impedia um PR quebrado de ir pra `main`, que já tem deploy automático de
produção nos dois projetos Vercel (Next.js e Django).

- **Job `nextjs`**: sobe um Postgres de serviço, gera um par de chaves RS256 e
  uma `MFA_ENCRYPTION_KEY` novos só pra esse job (nunca os segredos reais de
  produção), roda `npm run lint`, `npm run typecheck`, `npm test` e, na
  sequência, `npx playwright install --with-deps chromium` + `npm run
  test:e2e` (reaproveita o mesmo Postgres/segredos do job — os testes E2E
  sobem seu próprio `next dev` na porta 3200, ver `playwright.config.ts`). Em
  falha, as traces (`test-results/`) sobem como artifact do job pra depurar
  com `npx playwright show-trace`.
- **Job `django`**: roda `pytest` contra SQLite (sem precisar subir Postgres
  nesse job — `comum/autenticacao.py` só valida o JWT, não tem model de
  usuário próprio).

## Rotas de API

| Método | Rota                       | Descrição                                                              |
| ------ | -------------------------- | ------------------------------------------------------------------------ |
| POST   | `/api/auth/cadastro`       | Cria um novo usuário                                                     |
| POST   | `/api/auth/login`          | Autentica; retorna tokens ou `{ mfaObrigatorio: true }` se MFA ativado   |
| POST   | `/api/auth/atualizar`      | Rotaciona o token de atualização e emite novo acesso                     |
| POST   | `/api/auth/logout`         | Revoga o token de atualização atual                                      |
| GET    | `/api/auth/me`             | Retorna o usuário autenticado (rota protegida, exemplo)                  |
| PUT    | `/api/auth/senha`          | Troca a senha estando logado, exigindo a senha atual (rota protegida)    |
| POST   | `/api/auth/alterar-email`  | Envia link de confirmação para o e-mail NOVO (rota protegida)            |
| POST   | `/api/auth/confirmar-alteracao-email` | Confirma o link e efetiva a troca de e-mail                   |
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
| GET    | `/api/auth/minha-conta`    | Exporta os dados que este serviço guarda sobre o titular (rota protegida) |
| DELETE | `/api/auth/minha-conta`    | Exclui a própria conta, exigindo a senha atual (rota protegida)          |
| GET    | `/api/auth/passkeys`       | Lista as passkeys do usuário autenticado (sem publicKey/credentialId)   |
| DELETE | `/api/auth/passkeys/[id]`  | Remove uma passkey do usuário autenticado                               |
| POST   | `/api/auth/passkeys/registro/opcoes` | Gera as opções de registro WebAuthn (rota protegida)           |
| POST   | `/api/auth/passkeys/registro/confirmar` | Verifica a attestation e persiste a passkey nova (rota protegida) |
| POST   | `/api/auth/passkeys/login/opcoes` | Gera as opções de login "descobrível" (público, sem `allowCredentials`) |
| POST   | `/api/auth/passkeys/login/confirmar` | Verifica a assertion e conclui o login sem senha                |
| GET    | `/api/auth/usuarios`       | Lista usuários — restrito a `papel = admin`                             |
| GET    | `/api/auth/auditoria`      | Lista os últimos 200 logs de auditoria, com filtro por `evento`/`email` — restrito a `papel = admin` |
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
`JWT_REDEFINICAO_SENHA_SECRET`, `JWT_ALTERACAO_EMAIL_SECRET`,
`MFA_ENCRYPTION_KEY` e `CRON_SECRET`.

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

### Todo `DateTime` é `timestamptz`

Todas as colunas de data do schema (`prisma/schema.prisma`) usam `@db.Timestamptz`,
nunca o `timestamp` (sem fuso) que é o default do Prisma pra Postgres. A
diferença importa de verdade: um `timestamp` sem fuso grava só os números "de
parede" sob o fuso da SESSÃO que fez o insert (neste app, sempre GMT — nenhuma
conexão roda `SET TIME ZONE`) e devolve texto sem nenhuma marca de fuso; o
parser do node-postgres (`postgres-date`) então reconstrói esse texto com o
construtor de **horário local do processo que está lendo**, não UTC. Rodando
em produção (Vercel roda em UTC) isso coincide por acaso e passa despercebido
— mas qualquer script/ferramenta rodado de outro fuso (ex.: local no Brasil,
UTC-3) lê a mesma linha deslocada em ~3h. `timestamptz` elimina a ambiguidade:
o valor sai do banco com o offset embutido, e a leitura fica correta não
importa o fuso de quem lê. Migration:
`prisma/migrations/20260812195844_colunas_datetime_timestamptz`.

## Segurança em produção

### Gerar segredos fortes

O token de acesso usa um par de chaves RS256 (`npm run gerar:chaves-rs256`,
que preenche `JWT_ACCESS_PRIVATE_KEY_B64`/`JWT_ACCESS_PUBLIC_KEY_B64`).

Os demais `*_SECRET` do `.env` precisam de um valor aleatório e único — nunca
reuse o mesmo valor entre `JWT_REFRESH_SECRET`, `JWT_MFA_SECRET`,
`JWT_VERIFICACAO_EMAIL_SECRET`, `JWT_REDEFINICAO_SENHA_SECRET`,
`JWT_ALTERACAO_EMAIL_SECRET` e `MFA_ENCRYPTION_KEY`, pois eles isolam os tipos de token/dado entre si (o
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
formato versionado `v1:iv:authTag:ciphertext` em base64 — blobs legados de
3 partes sem prefixo de versão continuam decifráveis) com uma chave própria
(`MFA_ENCRYPTION_KEY`, 32 bytes em base64, distinta dos segredos JWT) — se o
banco vazar, os segredos TOTP não vazam junto. Gere com:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

#### Bloqueio de replay do código TOTP

Um código TOTP válido só pode completar um login (ou confirmar/desativar o
MFA) **uma vez**: `verificarCodigoMfaSemReplay` (`src/lib/mfa.ts`) grava o
timestep aceito em `Usuario.mfaUltimoTimestep` via um `UPDATE` atomicamente
condicionado (`mfaUltimoTimestep < novoTimestep`), então reusar o mesmo
código — mesmo ainda dentro da janela de tolerância de ±30s do relógio — é
rejeitado como se fosse inválido. Da mesma forma, o próprio desafio de login
(`mfaToken`) é de uso único: `DesafioMfaConsumido` (`src/lib/desafioMfa.ts`)
guarda o `jti` do token num insert com chave única, então uma segunda
conclusão bem-sucedida com o mesmo `mfaToken` falha mesmo que o JWT em si
ainda seja válido pelos 5 minutos de prazo. Um código incorreto ou expirado
não consome nem o timestep nem o `jti` — não pode "gastar" a tentativa de um
usuário legítimo que só errou a digitação.

#### Rotação de `MFA_ENCRYPTION_KEY`

Trocar `MFA_ENCRYPTION_KEY` sem downtime (ex.: suspeita de vazamento, rotina
de segurança) usa uma chave anterior temporária como fallback de leitura:

1. Gere uma chave nova com o mesmo comando acima.
2. No ambiente, copie o valor **atual** de `MFA_ENCRYPTION_KEY` para
   `MFA_ENCRYPTION_KEY_ANTERIOR` e troque `MFA_ENCRYPTION_KEY` pela chave
   nova. Faça o deploy dessa mudança de env **antes** do próximo passo — com
   as duas presentes, `descriptografar` (`src/lib/cripto.ts`) tenta a chave
   atual e cai para a anterior automaticamente, então logins continuam
   funcionando enquanto nem todo `mfaSecret` foi re-cifrado.
3. Rode `npm run rotacionar:chave-mfa` (contra o mesmo `DATABASE_URL` de
   produção) — `scripts/rotacionar-chave-mfa.mjs` decifra o segredo de cada
   usuário e re-cifra com a chave atual, deixando todo mundo na mesma
   chave/versão de formato.
4. Confira a saída (0 falhas) e só então remova `MFA_ENCRYPTION_KEY_ANTERIOR`
   do ambiente.

Se `descriptografar` falhar mesmo com o fallback (ex.: `MFA_ENCRYPTION_KEY_ANTERIOR`
configurada com o valor errado, ou o script de rotação não foi rodado antes
de trocar a chave), as quatro rotas que decifram `mfaSecret` (`mfa/confirmar`,
`mfa/verificar`, `mfa/desativar`, `mfa/backup/regenerar`) capturam isso —
`verificarCodigoMfaSemReplay` (`src/lib/mfa.ts`) lança `ErroSegredoMfaIlegivel`
— e respondem `500` com uma mensagem genérica, logando o erro real no
servidor. Sem esse tratamento, a exceção subia crua e o Vercel devolvia corpo
vazio: o cliente via `Unexpected end of JSON input` em vez de qualquer
mensagem, mascarando o problema real por trás de "código inválido".

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

### Lembrar este dispositivo

Ao concluir o desafio de MFA (`POST /api/auth/mfa/verificar`), marcar
`lembrarDispositivo: true` no corpo emite um cookie httpOnly
(`dispositivoConfiavel`, 30 dias) cujo token só existe hasheado (SHA-256,
`hashToken` — mesmo esquema do token de atualização) na tabela
`DispositivoConfiavel` (`src/lib/dispositivoConfiavel.ts`). Nos próximos
logins nesse navegador, `POST /api/auth/login` reconhece o cookie e pula
direto para a criação da sessão — **a senha continua sendo exigida sempre**,
só o segundo fator é dispensado. Um dispositivo novo (sem o cookie, ou com um
expirado) continua passando pelo desafio normalmente.

Trocar a senha (redefinição por e-mail ou `PUT /api/auth/senha`) **revoga
todos os dispositivos confiáveis** do usuário, junto das sessões ativas — uma
senha comprometida não pode deixar um atalho antigo pra pular o MFA depois da
recuperação. A limpeza periódica de tokens (`npm run limpeza:tokens`) também
remove os registros já expirados.

### Passkeys (WebAuthn)

Login sem senha (`@simplewebauthn/server` + `@simplewebauthn/browser`),
resistente a phishing: a assinatura fica atrelada à origem que o browser
verificou de verdade, então uma página clonada não consegue arrancar uma
assinatura válida. Complementa a senha — quem cadastra uma passkey continua
com a senha funcionando normalmente.

- **Cadastrar** (autenticado, no dashboard): `POST /api/auth/passkeys/registro/opcoes`
  gera as opções (`generateRegistrationOptions`, `residentKey: "required"`)
  e um `passkeyToken` de curta duração (2 min) carregando o `challenge`;
  `POST /api/auth/passkeys/registro/confirmar` verifica a attestation
  (`verifyRegistrationResponse`) e persiste a credencial em `PasskeyCredencial`
  (chave pública, contador, transportes — nunca a chave privada, que não sai
  do authenticator).
- **Login sem e-mail**: `POST /api/auth/passkeys/login/opcoes` é público e
  não recebe `allowCredentials` — é o que faz o browser oferecer as passkeys
  já salvas pra este site sem precisar digitar nada antes. `POST
  /api/auth/passkeys/login/confirmar` acha a credencial pelo `id` que veio na
  resposta, valida a assinatura (`verifyAuthenticationResponse`) contra o
  `challenge` do `passkeyToken` e conclui o login — **sem** passar pelo
  desafio de TOTP separado, mesmo com MFA ativado: posse do authenticator +
  presença do usuário (biometria/PIN local) já equivale a um segundo fator.
- O `challenge` de cada cerimônia é de uso único (mesma tabela de
  `consumirDesafioMfaJti` usada pelo desafio de MFA) — sem isso, uma resposta
  assinada capturada em trânsito poderia ser reapresentada até o token
  expirar.
- O contador do authenticator (`PasskeyCredencial.contador`) precisa SUBIR a
  cada uso; um authenticator genuíno nunca reusa/retrocede o valor — é o sinal
  clássico de detecção de clonagem de credencial.
- Configuração: `JWT_PASSKEY_SECRET`, `PASSKEY_RP_ID` (domínio exato, sem
  porta/protocolo), `PASSKEY_RP_NAME` e `PASSKEY_ORIGIN` (origem completa) —
  ver `.env.example`. `RP_ID`/`ORIGIN` precisam bater exatamente com o que o
  browser reportou, senão a cerimônia é recusada.
- Login por passkey passa pelas mesmas checagens de suspensão, "dispositivo
  novo" e "viagem impossível" do login por senha, e conta para o mesmo limite
  de sessões simultâneas.

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

### Alterar e-mail

`POST /api/auth/alterar-email` (autenticado, `{ novoEmail }`) **não muda o
e-mail na hora** — gera um token stateless próprio (`JWT_ALTERACAO_EMAIL_SECRET`,
1h de validade, mesmo padrão dos outros) e manda um link de confirmação pro
endereço **novo**. Só quando esse link é clicado (`POST
/api/auth/confirmar-alteracao-email`, público, `/confirmar-alteracao-email?token=...`
na UI) é que `Usuario.email` realmente troca — sem essa confirmação em duas
etapas, um endpoint autenticado sozinho bastaria pra sequestrar
silenciosamente uma conta com apenas o access token (ex. roubado por XSS
antes do cookie httpOnly, ou uma sessão deixada aberta).

- O e-mail antigo é liberado (`Usuario.email` é `@unique`) só depois da
  confirmação — pedir a troca não bloqueia ninguém de cadastrar esse
  endereço antigo de novo.
- Confirmar o link também marca `emailVerificado = true`: o endereço acabou
  de ser provado pelo clique, não faz sentido pedir uma segunda verificação.
- O endereço **antigo** recebe um aviso de segurança
  (`enviarEmailEmailAlterado`) assim que a troca se efetiva — se não foi o
  dono da conta que pediu, é o único jeito de saber e reagir.
- Confirmar a troca **revoga todas as sessões ativas e os dispositivos
  confiáveis** do usuário, igual ao "esqueci a senha": trocar o e-mail troca
  o canal de recuperação da conta, então se um access token roubado chegou a
  pedir a troca, toda sessão (a do atacante e a do dono) cai e o dono
  reentra com o e-mail novo. Como este endpoint é público (o link é clicado
  de qualquer navegador), não dá pra preservar só a sessão que pediu — como
  a troca de senha logado faz — então derruba todas.
- O link é de **uso único**: `Usuario.emailAlteradoEm` marca o instante da
  troca e qualquer token de alteração com `iat` anterior a ele é rejeitado
  (mesma técnica do `senhaAlteradaEm` na redefinição de senha), então o
  próprio uso invalida o link para uma segunda vez.
- Corrida entre o pedido e a confirmação (outra conta registra o mesmo
  e-mail novo nesse meio-tempo): a constraint `@unique` do banco é quem
  garante a segurança de verdade — a checagem prévia na rota de pedido é só
  pra dar um erro mais cedo no caso comum, não a defesa contra a corrida.

### Painel de auditoria (admin)

`GET /api/auth/auditoria` (restrito a `papel = admin`) lista os últimos 200
registros de `LogAuditoria` — mais recentes primeiro, com filtro opcional
por `?evento=` e `?email=` (`contains`, case-sensitive pelo collation do
Postgres). Não é uma tabela nova nem um pipeline novo: `LogAuditoria` já
existia desde o rate limiting; esta rota só expõe o que já é gravado.
`/dashboard/auditoria` é a tela correspondente, pro admin não precisar abrir
o Prisma Studio ou uma conexão direta no banco pra investigar um incidente.

Ações administrativas sobre OUTRA conta (suspender, reativar, excluir)
gravam também `autorId`/`autorEmail` no mesmo registro — sem isso, o log só
dizia O QUE aconteceu com o alvo, não QUEM (qual admin) fez a mutação.
`usuarioId`/`email` continuam descrevendo o alvo da ação, como sempre.

### Viagem impossível

Login route (`POST /api/auth/login`) compara o país da requisição atual
(headers `x-vercel-ip-*`, mesma fonte da seção "Tipo de dispositivo e
localização" abaixo) com o país da **sessão mais recente** do usuário
(`TokenAtualizacao.geoPais`, já persistido por login/MFA/rotação — nenhuma
tabela nova). Dois países **diferentes** em menos de **2 horas**
(`JANELA_VIAGEM_IMPOSSIVEL_MS`) dispara `enviarEmailViagemImpossivel` em vez
do e-mail de "dispositivo novo" (os dois juntos seriam redundantes pro mesmo
login suspeito).

**Limitação assumida, não escondida**: os headers da Vercel só dão
país/região/cidade aproximados, sem latitude/longitude — não dá pra calcular
distância ou velocidade de verdade. A heurística é grosseira por design
(país diferente + janela curta), não uma reconstrução de trajeto real; existe
pra pegar o caso óbvio (duas sessões em continentes diferentes minutos uma
da outra), não pra detectar toda anomalia geográfica possível. Fora da
Vercel (dev local), os headers não existem e a checagem simplesmente não
dispara — sem falso positivo, mas também sem proteção nesse ambiente.

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

### Autoatendimento LGPD (exportar/excluir a própria conta)

Até então só um admin conseguia excluir a conta de outra pessoa
(`DELETE /api/auth/usuarios/[id]`) — o próprio titular não tinha como
exportar nem apagar os próprios dados sem pedir pra um admin.

- `GET /api/auth/minha-conta` (autenticado) exporta o que este serviço
  guarda sobre o titular: dados pessoais, sessões (sem `tokenHash`),
  dispositivos confiáveis, códigos de backup de MFA (só `criadoEm`/`usadoEm`,
  nunca o hash), passkeys (apelido, transportes, `criadoEm`/`ultimoUsoEm` —
  sem o `credentialId` nem a chave pública, que são material de credencial,
  não dado pessoal útil) e os últimos 500 logs de auditoria sobre a conta.
  **Não** inclui Projeto/Tarefa do serviço de domínio (`django/`) — é uma
  database separada sem FK real com o usuário (só o claim `sub` do JWT como
  referência opaca); juntar os dois exigiria o Next.js chamar o Django
  internamente, escopo maior que o deste item.
- `DELETE /api/auth/minha-conta` (`{ senha }`) exclui a conta
  permanentemente — mesma fricção de `PUT /api/auth/senha`: exige a senha
  atual (com rate limit e log de falha compartilhados com a troca de senha,
  ver "Rate limiting" abaixo), porque um access token roubado sozinho não
  deveria bastar pra apagar a conta inteira.
- A tela correspondente fica em `/dashboard`, seção "Meus dados" — exportar
  baixa um `.json`; excluir pede a senha antes de confirmar.

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

### Tipo de dispositivo e localização nas sessões ativas

`TokenAtualizacao` guarda `ip`, `userAgent` e geolocalização (`geoCidade`,
`geoRegiao`, `geoPais`) capturados no momento em que a linha foi criada —
login, conclusão de MFA (`/mfa/verificar`, `/mfa/backup`) ou rotação em
`/atualizar`. `GET /api/auth/sessoes` devolve, por sessão, `tipoDispositivo`
(`"desktop" | "tablet" | "mobile" | "desconhecido"`, derivado do User-Agent em
`src/lib/dispositivo.ts` — classificação leve por regex, sem dependência tipo
`ua-parser-js`) e `localizacao` (string pronta "Cidade, UF, País", montada em
`src/lib/geo.ts`), exibidos na seção "Sessões ativas" do dashboard.

A geolocalização não usa nenhum serviço externo de geo-IP: a Vercel já
resolve o IP da requisição e injeta o resultado nos headers
`x-vercel-ip-city`, `x-vercel-ip-country-region` e `x-vercel-ip-country`
(https://vercel.com/docs/edge-network/headers#x-vercel-ip-city) — plataforma
nativa, sem custo e sem chamada de rede extra por login. Fora da Vercel (dev
local, outro host) esses headers simplesmente não existem, então
`localizacao` vem `null` e a UI mostra "Localização desconhecida". O nome do
país é resolvido do código ISO via `Intl.DisplayNames` nativo do Node
(`pt-BR`), sem tabela própria; cidade e UF são exibidos como a Vercel os
retorna.

Como cada rotação de refresh token cria uma linha nova em `TokenAtualizacao`,
IP/UA/geo são **recapturados a cada `/atualizar`** (não copiados do token
anterior) — a lista reflete onde o dispositivo está agora, não só no login
original. Sessões criadas antes desta migration (ou logadas fora da Vercel)
ficam com "Dispositivo desconhecido"/"Localização desconhecida" até serem
renovadas. Migration:
`prisma/migrations/20260813182108_sessoes_ip_useragent_geo`.

### Senha vazada (Have I Been Pwned)

Cadastro (`POST /api/auth/cadastro`) e troca de senha (`POST
/api/auth/redefinir-senha`, `PUT /api/auth/senha`) recusam qualquer senha já
vista em vazamentos de dados reais, via a API pública do
[Have I Been Pwned](https://haveibeenpwned.com/API/v3#PwnedPasswords)
(`src/lib/senhaVazada.ts`). Usa **k-anonymity**: só os 5 primeiros caracteres
do hash SHA-1 da senha saem do servidor — o HIBP nunca recebe a senha nem o
hash completo, só um prefixo compartilhado por milhares de outras senhas, e a
comparação do sufixo acontece localmente na resposta.

Diferente do Turnstile (que É a barreira contra automação), essa checagem é
**best-effort, fail-open**: uma falha de rede ou o serviço fora do ar não
bloqueia cadastro/troca de senha, só deixa passar sem o aviso extra.

### Troca de senha estando logado

`PUT /api/auth/senha` (autenticado, `{ senhaAtual, novaSenha }`) complementa o
fluxo "esqueci a senha" (que só funciona por e-mail) — o usuário troca a
senha de dentro do dashboard, provando ser dono da conta com a senha atual em
vez de um link. Passa pela mesma checagem de senha vazada da seção acima.

Diferente da redefinição por e-mail (que não sabe quem está pedindo e por
isso derruba **todas** as sessões), aqui quem chamou já se autenticou com a
senha atual — a sessão de origem continua valendo, e só as **outras**
sessões (e qualquer "dispositivo confiável", ver seção própria abaixo) são
revogadas.

### Limite de sessões simultâneas

No máximo **5 sessões ativas por usuário** (`MAX_SESSOES_SIMULTANEAS`,
`src/lib/sessao.ts`) — a cada sessão nova (login ou conclusão de MFA), a
mais antiga além do limite é revogada automaticamente. Roda dentro de
`criarSessao` (o mesmo ponto usado por login, MFA e futuras formas de criar
sessão), não só na leitura da lista de "sessões ativas" — a sessão excedente
já não vale mais mesmo que o usuário nunca abra essa tela.

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
quantos eventos de um tipo vieram do mesmo IP dentro de uma janela de tempo
e responde `429` antes mesmo de processar a requisição. Aplicado em login (20 tentativas
erradas/15 min por IP — ver nota de IP compartilhado abaixo — **e** 20/15 min
por conta, o que vier primeiro), cadastro e recuperação de senha (5
tentativas/hora cada, só por IP).

**Atenção — IP não é sinônimo de pessoa**: várias contas atrás do mesmo NAT
(rede doméstica, Wi-Fi de escritório, operadora de celular) compartilham o
mesmo IP público de verdade, não é spoofing. O limite de login começou em 5
tentativas/IP e travava a casa inteira quando uma única pessoa errava a
senha algumas vezes — por isso subiu pra 20, generoso o bastante pra não
incomodar uso legítimo em rede compartilhada, com o CAPTCHA (abaixo) e o
limite por CONTA como as barreiras de verdade contra automação. Cadastro e
recuperação de senha continuam em 5/IP: não têm um limite por conta
equivalente (a conta ainda não existe), então o IP é a única linha de
defesa ali — subir esse valor é uma troca de risco diferente, não incluída
nesse ajuste.

**Fonte do IP** (`obterIp` em `src/lib/rateLimit.ts`): usa
`x-vercel-forwarded-for` (ou `x-real-ip`), que a Vercel injeta com o IP real
resolvido pela edge network e o cliente não consegue sobrescrever. O
`x-forwarded-for` "cru" só entra como último recurso (proxy não-Vercel,
`next dev` local): na Vercel esse header é `<valor do cliente>, <IP real>` —
a Vercel **anexa** em vez de substituir, então confiar no item à esquerda
deixaria alguém girar valores pra burlar o limite ou plantar o IP de outra
pessoa pra bloqueá-la. Fora de um proxy confiável (dev), qualquer header de
IP é forjável — trade-off inevitável desse tipo de rate limit.

`PUT /api/auth/senha` e `DELETE /api/auth/minha-conta` compartilham o mesmo
evento (`senha_atual_falha`, 5 tentativas/5 min por IP **e** por conta) — as
duas rotas pedem a senha atual pra confirmar uma ação sensível numa sessão já
autenticada, então o orçamento de tentativas erradas é o mesmo em ambas, não
um limite dobrado. `POST /api/auth/passkeys/login/confirmar` tem seu próprio
limite (20/15 min, mesmo valor do login por senha).

### CAPTCHA (Cloudflare Turnstile)

Fricção progressiva contra automação em `POST /api/auth/login` (a partir de
**5 falhas do mesmo IP**) e `POST /api/auth/cadastro` (a partir de **3**) —
`LIMITE_FALHAS_ANTES_DE_CAPTCHA`/`LIMITE_TENTATIVAS_ANTES_DE_CAPTCHA` em cada
rota. A partir daí a rota passa a exigir um `turnstileToken` válido; antes
disso, o fluxo normal nem sabe que o CAPTCHA existe.

- **Backend** (`src/lib/turnstile.ts`): `verificarTurnstile` chama a API
  `siteverify` do Cloudflare. Fail-closed quando `TURNSTILE_SECRET_KEY` está
  configurada (token ausente, resposta negativa ou erro de rede => reprova) —
  diferente do e-mail (best-effort), aqui a verificação É a barreira, então
  "passar direto" numa falha anularia o propósito. Sem a chave, a verificação
  é pulada (não trava dev/test sem conta Cloudflare).
- **Frontend** (`src/components/DesafioTurnstile.tsx`): as telas de
  `/login` e `/cadastro` só renderizam o widget depois que a API responde
  `{ captchaNecessario: true }` (400) — o cliente reconhece essa resposta via
  `ErroCaptchaNecessario` (`src/lib/clienteAuth.ts`) e diferencia de
  "credenciais erradas". O componente carrega o script oficial
  `challenges.cloudflare.com/turnstile/v0/api.js` e renderiza o widget num
  container próprio; o botão de envio fica desabilitado até o callback do
  Turnstile entregar um token. Como o token é de uso único, cada tentativa
  reprovada remonta o widget (via `key`) para pedir um novo — inclusive
  quando o CAPTCHA passou mas a senha estava errada, já que o token daquela
  submissão foi consumido no `siteverify` de qualquer forma.
- **As duas chaves são independentes e precisam ser configuradas juntas**:
  `TURNSTILE_SECRET_KEY` (backend, nunca vai pro cliente) e
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (frontend, embutida no bundle — é assim
  que o Turnstile funciona, a site key não é secreta). Configurar só uma
  trava quem passar do limite: com a secret key mas sem a site key, o widget
  nunca renderiza e ninguém consegue gerar um token válido. As duas vêm do
  mesmo widget em https://dash.cloudflare.com/?to=/:account/turnstile.
- CSP (`next.config.ts`) libera `challenges.cloudflare.com` em `script-src`,
  `connect-src` e `frame-src` — sem isso o script é bloqueado, ou carrega e o
  iframe do desafio fica em branco.

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

### Observabilidade (Rollbar)

Antes disso, um erro inesperado (não um `console.error` de um catch já
tratado — esses continuam só logando, de propósito) só ia parar nos logs da
Vercel: sem alerta, sem agregação, sem saber se um erro é novo ou já
conhecido. `rollbar` + `@rollbar/react` cobrem os dois lados:

- **Servidor**: `src/instrumentation.ts` exporta `onRequestError`, hook
  nativo do Next.js (estável desde a v15) chamado automaticamente pro
  servidor sempre que ele mesmo captura um erro não tratado — em Server
  Components, Route Handlers ou Server Actions — sem precisar de try/catch
  espalhado em cada rota de API. A instância fica em `src/lib/rollbarServidor.ts`
  (`"server-only"`, nunca vai pro bundle do cliente). O mesmo arquivo também
  exporta `register()` (ver "Checagem de config de produção" abaixo).
- **Cliente**: `src/app/error.tsx` (erro de render dentro do layout raiz) e
  `src/app/global-error.tsx` (erro no próprio layout raiz — precisa da sua
  própria instância do Rollbar, já que o `RollbarProvider` do layout não
  está disponível nesse caso) reportam via `rollbar.error(error)`. O layout
  raiz (`src/app/layout.tsx`) envolve a árvore inteira num `RollbarProvider`
  (`src/lib/rollbar.ts`) pra qualquer componente cliente poder usar
  `useRollbar()`.

Provisionado via Vercel Marketplace (`vercel integration add
rollbar/error-tracking`, tier gratuito de 5.000 eventos/mês), que já criou
as env vars `ROLLBAR_AUTH_GATEWAY_SERVER_TOKEN_1787151157` e
`NEXT_PUBLIC_ROLLBAR_AUTH_GATEWAY_CLIENT_TOKEN_1787151157` — sem essas
variáveis (dev local sem `vercel env pull`, ou CI) o Rollbar só não envia
nada, não quebra a aplicação.

### Checagem de config de produção

Vários recursos degradam **em silêncio** quando falta a env var
correspondente — por design, pra não travar quem roda localmente sem conta
na Cloudflare/Resend/Rollbar. Num deploy de produção que esqueceu de
configurar algo, isso passa despercebido. `src/lib/configProducao.ts`
(chamado por `register()` em `src/instrumentation.ts`, só quando
`NODE_ENV === "production"`) fecha essa lacuna:

- **Aborta o boot** (o `register` precisa terminar antes de o servidor
  aceitar requisições, então lançar aqui derruba a instância) quando a config
  deixaria a aplicação quebrada: `BASE_URL` ausente (links de e-mail
  apontariam pra `localhost`) ou Turnstile configurado pela metade (depois de
  algumas tentativas o login exige um CAPTCHA que o front, sem a site key,
  não consegue renderizar — a pessoa fica trancada pra fora).
- **Loga um aviso** e segue quando é degradação tolerável: sem
  `RESEND_API_KEY` (e-mails só no log), sem token do Rollbar (erros não
  reportados), sem `CRON_SECRET` (limpeza de tokens não roda), Turnstile
  totalmente ausente (CAPTCHA desativado).

Os segredos JWT e a `MFA_ENCRYPTION_KEY` não entram aqui porque já falham o
boot por conta própria (`throw` em `src/lib/token.ts`).

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
  `JWT_REDEFINICAO_SENHA_SECRET`, `JWT_ALTERACAO_EMAIL_SECRET`,
  `MFA_ENCRYPTION_KEY`, `CRON_SECRET`,
  `BASE_URL`, `DJANGO_SERVICE_URL` (aponta para a URL de produção do projeto
  Django), além de `DATABASE_URL` (injetada automaticamente pela integração
  Neon) e `ROLLBAR_AUTH_GATEWAY_SERVER_TOKEN_1787151157`/
  `NEXT_PUBLIC_ROLLBAR_AUTH_GATEWAY_CLIENT_TOKEN_1787151157` (injetadas
  automaticamente pela integração Rollbar, nos 3 ambientes — production,
  preview e development).
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
