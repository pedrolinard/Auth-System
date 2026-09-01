# Roadmap — Sistema de Autenticação Intermediária

> Gerado em 2026-07-13. Atualizado em 2026-07-16 (índice composto em `LogAuditoria` pra acelerar as consultas do rate limit). Atualizado em 2026-07-14 (todos os itens de prioridade Alta e Média entregues: paridade da página de cadastro, recuperação de senha, testes automatizados das rotas de auth do Next.js, rate limiting, verificação de e-mail, RBAC, sair de todos os dispositivos, access token em cookie httpOnly, CSRF explícito, logs de auditoria — além do serviço de domínio Django/DRF e das 5 melhorias anteriores). **Nenhum item pendente no momento.** Sistema em produção na Vercel desde 2026-07-14 (ver seção "Deploy em produção" abaixo).
>
> Atualizado em 2026-08-31 (varredura de segurança — 1ª leva: senha na troca de e-mail, `userVerification: required` nas passkeys, `.max` no nome, CSP libera Rollbar, hardening do Django, upgrade de deps com CVE. 2ª leva: export LGPD exige senha + vira POST, limite por e-mail no `esqueci-senha`, `iss`/`aud` no access token, retenção da auditoria, CSP com `object-src 'none'`, export de auditoria em PDF). A fonte única de verdade do roadmap agora é `src/data/roadmap.ts` (renderizada em `/roadmap`); este arquivo é um retrato resumido.
>
> Atualizado em 2026-09-01 (Turnstile ativado em produção com chaves reais da Cloudflare; corrigido também um `.vercelignore` desatualizado que fazia `vercel deploy` local subir `node_modules`/`.next` inteiros por ignorar o `.gitignore`. Depois: contador de rate limit dedicado — tabela `limites_taxa` substitui o `count()` sobre `LogAuditoria`. Depois: observabilidade no Django — recurso Rollbar próprio via Vercel Marketplace + `RollbarNotifierMiddleware`, fechando o último item pendente da varredura de 08-31 que não era um trade-off deliberado. Depois: integrações Neon desconectadas dos dois projetos (rollback pós-migração pro Supabase, confirmado estável) — achado no processo: a seção "Deploy (Vercel)" do `README.md` ainda dizia que o Django "continua na Neon", desatualizada desde a migração de 08-29; corrigida. Depois: **multi-tenant (organizações)** — `Organizacao`/`Membro`/`ConviteOrganizacao` novos, organização ativa vira claim no access token (`organizacaoId`/`papelOrganizacao`), troca de organização sem reautenticar, Django isolado por `organizacao_id`, RBAC de admin escopado por organização (não mais só o `papel` de sistema), convites por e-mail com aceite idempotente, seletor de organização e tela `/dashboard/organizacoes` no frontend — implementado em 5 fases, cada uma revisada e corrigida antes da próxima; **ainda não implantado em produção** (rodar os backfills contra os bancos de produção, Next.js e Django, é uma decisão em aberto). Contagens de teste: **218 no total** — 176 Vitest + 6 E2E Playwright + 36 Django.

## ✅ Feito

### Backend / API (`src/app/api/auth/`)
- `POST /cadastro` — cria usuário com senha hasheada (bcrypt, 12 rounds), valida com Zod, trata e-mail duplicado (409); gera token de verificação de e-mail (link logado no console) e registra auditoria
- `POST /login` — valida credenciais, emite access token (JWT, 15 min) + refresh token (JWT, 30 dias) ou, se o usuário tiver MFA ativado, devolve um desafio (`mfaObrigatorio`); registra auditoria (sucesso/falha)
- `POST /atualizar` — renova tokens com **rotação de refresh token** (revoga o antigo, emite novo em transação), aceita token via cookie ou body; protegido por CSRF; erros inesperados do Prisma tratados/logados
- `POST /logout` — revoga o refresh token no banco e limpa os cookies (atualização, acesso, CSRF); protegido por CSRF; registra auditoria
- `GET /me` — retorna usuário autenticado via cookie httpOnly ou Bearer token (inclui `mfaAtivado`, `emailVerificado`, `papel`)
- `GET /sessoes` — lista as sessões (tokens de atualização) ativas do usuário autenticado
- `DELETE /sessoes/[id]` — revoga uma sessão específica do usuário autenticado; protegido por CSRF
- `DELETE /sessoes` — **"sair de todos os dispositivos"**: revoga todas as sessões do usuário; protegido por CSRF
- `POST /mfa/iniciar`, `/mfa/confirmar`, `/mfa/desativar`, `/mfa/verificar` — fluxo completo de verificação em duas etapas (TOTP); as três primeiras protegidas por CSRF
- `POST /verificar-email` — confirma o e-mail a partir do token do link (`emailVerificado = true`)
- `POST /esqueci-senha` — gera token de redefinição de senha (link logado no console), resposta genérica anti-enumeração
- `POST /redefinir-senha` — redefine a senha a partir do token e revoga todas as sessões ativas do usuário
- `GET /usuarios` — lista os **membros da organização ativa**, restrito a dono/admin *dessa organização* (RBAC por organização — ver seção "Multi-tenant" abaixo — não mais o `papel` de sistema global)
- `DELETE /usuarios/[id]` — remove o membro da organização ativa (não exclui a conta); bloqueia remover o último dono
- `POST /api/cron/limpar-tokens` — remove tokens expirados/revogados antigos, protegido por `CRON_SECRET`
- `GET /organizacoes`, `POST /organizacoes` — lista as organizações de que o usuário é membro / cria organização nova (dono automático, rate limit 10/h por IP), reemitindo a sessão já ativa na organização recém-criada
- `POST /organizacoes/[id]/entrar` — troca a organização ativa da sessão sem pedir senha de novo (reemite tokens)
- `GET /organizacoes/convites`, `POST /organizacoes/convites` — lista convites pendentes da organização ativa / cria convite por e-mail (restrito a dono/admin; rate limit por IP e por e-mail alvo)
- `DELETE /organizacoes/convites/[id]` — revoga um convite pendente
- `POST /organizacoes/aceitar-convite` — aceita um convite (autenticado, idempotente sob aceite concorrente)

### Lib (`src/lib/`)
- `token.ts` — geração/verificação de JWT (jose): acesso (RS256, claims `papel`/`organizacaoId`/`papelOrganizacao`, `iss` fixo validado aqui e no Django), atualização, desafio MFA, verificação de e-mail, redefinição de senha e convite de organização (cada um com segredo próprio), hash SHA-256 do refresh token
- `senha.ts` — hash/verificação de senha (bcryptjs)
- `mfa.ts` — geração de segredo TOTP, QR code (otpauth + qrcode) e verificação de código
- `sessao.ts` — emissão compartilhada de tokenAcesso/tokenAtualizacao/csrfToken em cookies httpOnly (usada por login, conclusão de MFA e troca de organização); resolve a organização ativa (primeira organização de que o usuário é membro, por ordem de entrada) quando nenhuma é passada explicitamente
- `organizacao.ts` — geração de slug único, criação da organização pessoal no cadastro e criação de organização sob demanda (ambas numa transação Prisma: `Organizacao` + `Membro` dono)
- `rbacOrganizacao.ts` — checagem de papel dentro da organização ativa (dono/admin/membro) e busca de um membro específico, usados pelas rotas de admin escopadas por organização
- `limpezaTokens.ts` — lógica de remoção de tokens expirados/revogados antigos
- `cookies.ts` — cookies httpOnly (atualização, acesso) + cookie CSRF não-httpOnly, todos `secure`/`sameSite=lax`
- `csrf.ts` — geração e validação do token CSRF (double-submit cookie)
- `auditoria.ts` — registro de eventos (login, cadastro, logout) com IP/user-agent, best-effort
- `rateLimit.ts` — rate limiting por IP e por conta, contador dedicado (`limites_taxa`, janela fixa) (login, cadastro, recuperação de senha)
- `validacao.ts` — schemas Zod (cadastro, login, atualização, código MFA, verificação de e-mail, esqueci/redefinir senha)
- `clienteAuth.ts` — cliente client-side: cookies httpOnly (sem sessionStorage), refresh automático em 401, header CSRF automático, sessões, MFA e recuperação de senha
- `clienteOrganizacao.ts` — cliente client-side pra listar/criar organizações, trocar a ativa, listar/criar/revogar convites e aceitar convite
- `autenticar.ts` — helper que aceita o token via cookie httpOnly ou Bearer nas rotas

### Dados
- Prisma + **Postgres local** (`Usuario`, `TokenAtualizacao`, `LogAuditoria`), com campos de MFA (`mfaAtivado`, `mfaSecret`), `emailVerificado` e `papel` (enum `Papel`) — migrado de SQLite, dados existentes preservados
- `Organizacao`, `Membro` (`@@unique([organizacaoId, usuarioId])`, papel `dono`/`admin`/`membro` por linha) e `ConviteOrganizacao` (token próprio, `aceitoEm` marca uso único) — multi-tenant, ver seção "Multi-tenant (organizações)" abaixo
- Índice composto `(evento, ip, criadoEm)` em `LogAuditoria` — a consulta do `rateLimit.ts` roda em todo login/MFA/recuperação de senha e sem índice fazia table scan em caminho crítico de auth

### Deploy em produção (Vercel)
- Dois projetos Vercel independentes na mesma instância Supabase (schemas separados, sem FK entre eles): `auth-gateway` (Next.js, https://auth-gateway-kappa.vercel.app, schema `public`) e `auth-gateway-django` (Django, https://auth-gateway-django.vercel.app, schema `dominio`) — provisionado originalmente via Neon, migrado em 2026-08-29, integrações Neon desconectadas em 2026-09-01
- Segredos de produção (chaves RS256, JWT secrets, `CRON_SECRET`, `DJANGO_SECRET_KEY`) gerados exclusivamente para produção — isolados do `.env` local
- `django/vercel.json` declara `config/wsgi.py` como entrypoint da function
- `DJANGO_SERVICE_URL` no projeto Next.js aponta para o projeto Django, testado ponta a ponta em produção (cadastro → login → rewrite autenticado até o Django)
- Detalhes completos e como reproduzir o deploy: seção "Deploy (Vercel)" do `README.md`

### Serviço de domínio (Django/DRF)
- Token de acesso migrado de HS256 para **RS256** (`src/lib/token.ts`) — chave privada só no Next.js, pública compartilhável com outros serviços; refresh e desafio MFA continuam HS256 (nunca saem do Next.js)
- `django/` — serviço Django REST Framework sem login próprio: `comum/autenticacao.py` valida o JWT (RS256, `algorithms` fixo, via header Bearer **ou** cookie `tokenAcesso`) e usa os claims `sub`/`papel`/`organizacao_id` como identidade
- App `tarefas` com entidades reais: `Projeto` e `Tarefa` (status, prazo, relação por projeto), dados filtrados/gravados por `organizacao_id` (não mais `usuario_id` sozinho — ver "Multi-tenant" abaixo); rejeita criar tarefa em projeto de outra organização
- `next.config.ts` encaminha `/api/dominio/*` para o Django via rewrite (mesma origem, sem CORS) — cookies (acesso e CSRF) são repassados transparentemente
- **Postgres compartilhado** — mesma instância local do Next.js, database própria (`autenticacao_dominio`)
- `ProtegidoContraCsrf` (`comum/autenticacao.py`) — mesma proteção CSRF double-submit-cookie do lado Next.js, aplicada nas mutações de `ProjetoViewSet`/`TarefaViewSet`
- **Testes automatizados** (`pytest-django`): `comum/tests/test_autenticacao.py` (token válido/expirado/adulterado/confusão de algoritmo/via cookie/claims `papel`/`organizacao_id` + `ProtegidoContraCsrf` em tempo constante) e `tarefas/tests/test_views.py` (CRUD + isolamento por organização + CSRF ponta a ponta) — 36 testes

### Multi-tenant (organizações)
> Implementado em 5 fases (schema/backfill → sessão/token → Django → RBAC → convites/UI), cada fase revisada e corrigida antes da seguinte. **Ainda não implantado em produção.**
- Modelo "Slack-style": uma conta pode ser membro de várias organizações, com um papel próprio por organização (`dono`/`admin`/`membro`, em `Membro.papel`) — independente do `papel` de sistema (`usuario`/`admin`, em `Usuario.papel`) que já existia e continua só pro painel de auditoria
- A organização **ativa** da sessão é um claim no próprio access token (`organizacaoId`/`papelOrganizacao`), não resolvida por parâmetro de rota a cada requisição — decisão deliberada pra preservar o princípio de que o Django nunca consulta as tabelas do Next.js, só confia no JWT
- Trocar de organização ativa (`POST /api/auth/organizacoes/[id]/entrar`) reemite tokens sem pedir senha de novo, mesmo padrão que a conclusão de MFA já usa; trade-off aceito: uma organização ativa por sessão de navegador (trocar numa aba troca em todas)
- Django isolado por `organizacao_id`: `Projeto`/`Tarefa` só aparecem pra quem é membro da mesma organização; sessão sem organização ativa é rejeitada (403) em vez de vazar linhas órfãs pra quem estiver sem organização
- RBAC de admin (listar/suspender/reativar/remover membro) escopado por organização — dono/admin da organização A não enxerga nem afeta contas da organização B; suspender ainda é por conta inteira, não por organização (trade-off documentado em "O que falta" abaixo)
- Convites por e-mail: token JWT stateless com segredo próprio (`JWT_CONVITE_ORGANIZACAO_SECRET`), reconvidar o mesmo e-mail atualiza o convite pendente em vez de duplicar, aceite exige estar autenticado com a conta dona do e-mail convidado e é idempotente sob aceite concorrente (corrida tratada, sem 500)
- Rate limit dedicado: criar organização (10/h por IP) e enviar convite (30/h por IP + 5/h por e-mail alvo), mesmo padrão do resto do projeto
- Cadastro cria a organização pessoal do usuário numa transação (`Usuario` + `Organizacao` + `Membro` dono) — sem organização órfã se algo falhar no meio
- Frontend: seletor de organização ativa no `NavPainel`, `/dashboard/organizacoes` (criar organização, convidar/revogar convite) e `/aceitar-convite` (estado autenticado e não-autenticado)
- Backfill (`scripts/backfill-organizacoes.mjs` + `django/scripts/backfill_organizacoes.py`) cria a organização pessoal de cada conta pré-existente e reatribui `Projeto`/`Tarefa` antigos — idempotente, ainda não rodado em produção

### Frontend
- Páginas: home, `/login` (com segunda etapa de código MFA e link "Esqueci minha senha"), `/cadastro`, `/dashboard` (protegida, com seções de Segurança: sessões ativas e MFA), `/verificar-email`, `/esqueci-senha`, `/redefinir-senha`
- `/dashboard/projetos` e `/dashboard/projetos/[id]` — CRUD de projetos e tarefas consumindo o serviço Django via rewrite (`src/lib/clienteDominio.ts`)
- `/dashboard/organizacoes` e `/aceitar-convite` — gestão de organizações e aceite de convite (ver "Multi-tenant" acima)
- `proxy.ts` faz checagem otimista de sessão via cookie e redireciona rotas protegidas/somente-visitante
- Sem `sessionStorage` — access token e CSRF token viajam via cookie, o cliente não guarda nenhum token manualmente
- `login`/`cadastro` com o mesmo padrão de formulário (`autoFocus`, `autoComplete`, `CampoSenha` compartilhado com mostrar/ocultar senha)

### Testes automatizados (Next.js)
- **Vitest contra servidor `next dev` real** (não mocka `next/headers`), database dedicada `autenticacao_test` na mesma instância Postgres, `tests/globalSetup.ts` sobe/derruba o servidor e aplica as migrations
- 176 testes em `tests/api/*.test.ts` + `tests/lib/*.test.ts`: cadastro, login, sessões, MFA (códigos TOTP reais e backup), RBAC (sistema e por organização), recuperação/troca/alteração de e-mail e senha, verificação de e-mail, CSRF, rate limiting, viagem impossível, passkeys, organizações/convites, cron de limpeza, criptografia em repouso e comparação em tempo constante
- 6 testes E2E de navegador (Playwright): cadastro/login, dashboard protegido e passkeys via virtual authenticator

### Segurança já presente
- Senha hasheada (bcrypt)
- Refresh token hasheado no banco (não fica em texto puro)
- Rotação de refresh token
- Access token e refresh token em cookies **httpOnly** (não acessíveis a JavaScript — mitiga roubo via XSS)
- Access token de vida curta (15 min), assinado com RS256, com `iss`/`aud` carimbados e checados (Next.js + Django)
- Proteção CSRF explícita (double-submit cookie) em toda mutação autenticada por cookie, Next.js e Django
- Verificação em duas etapas (TOTP) opcional por usuário
- Verificação de e-mail (token stateless, link logado no console em dev)
- RBAC mínimo de sistema (`Usuario.papel`, claim no token) + RBAC por organização (`Membro.papel`: dono/admin/membro, escopando `/api/auth/usuarios` e ações administrativas — ver "Multi-tenant" acima)
- Gestão de sessões ativas (listar/revogar individualmente ou todas de uma vez)
- Logs de auditoria (login sucesso/falha, cadastro, logout — IP e user-agent)
- Job de limpeza de tokens expirados/revogados antigos
- Segredos JWT gerados aleatoriamente (não mais placeholders) e documentados
- Recuperação de senha (token stateless, 1h, revoga todas as sessões ao redefinir, resposta anti-enumeração)
- Rate limiting por IP em login, cadastro e recuperação de senha (contador dedicado, `limites_taxa`)
- Troca de e-mail exige a senha atual e avisa o endereço antigo já no pedido (não só na conclusão)
- Passkeys com `userVerification: required` no registro e no login + `requireUserVerification` no verify — a verificação local (biometria/PIN) é sempre exigida, então a passkey vale como 2 fatores mesmo pulando o TOTP
- `nome` com teto de 80 caracteres no schema Zod (renderizado no painel e em e-mails)
- CSP libera `api.rollbar.com` em `connect-src` (o relatório de erro do cliente era bloqueado em silêncio)
- Django com hardening de produção (`SECURE_PROXY_SSL_HEADER`, HSTS, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, nosniff, `X_FRAME_OPTIONS`) condicionado a `not DEBUG`
- Dependências com CVE atualizadas: Next.js 16.2.10 → 16.3.4 (bypass de middleware/proxy, SSRF em rewrites, cache confusion), Django 5.2.16 → 5.2.17, `cryptography` 43 → 50, DRF 3.15 → 3.18
- Export LGPD (`POST /api/auth/minha-conta/exportar`) exige a senha atual + CSRF + rate limit (era GET só com o cookie de acesso)
- `esqueci-senha` com limite por e-mail (3/h), sem quebrar a resposta anti-enumeração
- Access token carrega `iss`, validado no Next.js e no Django (`options={require:[exp,iss]}`) — `aud` foi removido em 2026-09-01 (quebrava consumidores que ainda não tinham sido atualizados)
- Retenção da trilha de auditoria: `POST /api/cron/limpar-tokens` poda `LogAuditoria` > 365 dias e `DesafioMfaConsumido` expirado (índice `criadoEm` novo)
- CSP com `object-src 'none'` e `upgrade-insecure-requests`
- Exportação da auditoria em PDF pra admins (jsPDF carregado sob demanda no clique)
- CAPTCHA (Turnstile) ativo em produção: `TURNSTILE_SECRET_KEY`/`NEXT_PUBLIC_TURNSTILE_SITE_KEY` configuradas na Vercel — fricção progressiva a partir da 5ª falha de login/cadastro por IP passa a exigir o desafio de verdade (fail-closed, confirmado em prod)
- Contador de rate limit dedicado (`limites_taxa`): uma linha por chave (ip/e-mail + evento), incrementada com `INSERT ... ON CONFLICT DO UPDATE` em janela fixa — substitui o `count()` sobre `LogAuditoria` que rodava a cada tentativa de login/cadastro/redefinição; `LogAuditoria` segue intacta para auditoria e detecção de dispositivo novo
- Observabilidade no Django: recurso Rollbar próprio (Vercel Marketplace, projeto `auth-gateway-django`) + `RollbarNotifierMiddleware` — mesmo provedor do Next.js, um 500 não tratado no serviço de domínio agora chega ao mesmo dashboard

## 🔧 O que falta / pode fazer

Da varredura de segurança de 2026-08-31, ainda em aberto (prioridade decrescente):

- **CSP com `script-src 'unsafe-inline'`** em produção — nonce por request força renderização dinâmica em todas as páginas (perde a otimização estática de `/`, `/login`, etc. e o cache de CDN); SRI hash-based é experimental. Adiado até valer o custo.
- **Enumeração de contas no cadastro** (409 "e-mail já cadastrado") — mantido de propósito: a alternativa tem custo de UX real pra quem esqueceu que já tem conta, e login/recuperação (os fluxos que importam) já não enumeram.

Do multi-tenant (2026-09-01), trade-off aceito por enquanto:

- **Suspensão de conta é por conta inteira, não por organização** — `suspenso`/`suspensoAte`/`suspensoMotivo` continuam campos globais do `Usuario`; um dono/admin que suspende alguém bloqueia o login em QUALQUER organização de que a pessoa participe, não só na organização ativa de quem suspendeu. Mover suspensão pra dentro de `Membro` é escopo maior (schema novo, refazer `estaSuspenso()` e todos os pontos de login) — não crítico o bastante pra ter bloqueado o multi-tenant por causa disso.

Itens fora de escopo intencional (rate limiting distribuído/Redis, envio real de e-mail) seguem documentados no `README.md`.

## 💡 Melhorias no que já existe

Todas as 5 identificadas foram aplicadas:

- ✅ **`atualizar/route.ts`** — erros inesperados do Prisma na transação de rotação agora são tratados/logados (`console.error` + `500` tratado).
- ✅ **`clienteAuth.ts` → `obterUsuarioAtual`** — a renovação automática agora é limitada a 1 tentativa (parâmetro `tentouRenovar`).
- ✅ **`dashboard/page.tsx`** — bloco que expunha o JWT de acesso na tela foi removido.
- ✅ **Mensagens de erro do login** — revisado, já seguia o padrão correto (não vaza se é e-mail ou senha errada).
- **`proxy.ts`** — mantido como está por decisão consciente: a doc oficial do Next.js 16 recomenda não usar o Proxy como solução completa de autorização/sessão; a validação real já acontece nas rotas de API (e agora também via CSRF explícito nas mutações).
