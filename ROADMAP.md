# Roadmap — Sistema de Autenticação Intermediária

> Gerado em 2026-07-13. Atualizado em 2026-07-14 (todos os itens de prioridade Alta e Média entregues: paridade da página de cadastro, recuperação de senha, testes automatizados das rotas de auth do Next.js, rate limiting, verificação de e-mail, RBAC, sair de todos os dispositivos, access token em cookie httpOnly, CSRF explícito, logs de auditoria — além do serviço de domínio Django/DRF e das 5 melhorias anteriores). **Nenhum item pendente no momento.** Sistema em produção na Vercel desde 2026-07-14 (ver seção "Deploy em produção" abaixo).

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
- `GET /usuarios` — lista usuários, restrito a `papel = admin` (exemplo de RBAC)
- `POST /api/cron/limpar-tokens` — remove tokens expirados/revogados antigos, protegido por `CRON_SECRET`

### Lib (`src/lib/`)
- `token.ts` — geração/verificação de JWT (jose): acesso (RS256, inclui claim `papel`), atualização, desafio MFA, verificação de e-mail e redefinição de senha (cada um com segredo próprio), hash SHA-256 do refresh token
- `senha.ts` — hash/verificação de senha (bcryptjs)
- `mfa.ts` — geração de segredo TOTP, QR code (otpauth + qrcode) e verificação de código
- `sessao.ts` — emissão compartilhada de tokenAcesso/tokenAtualizacao/csrfToken em cookies httpOnly (usada por login e conclusão de MFA)
- `limpezaTokens.ts` — lógica de remoção de tokens expirados/revogados antigos
- `cookies.ts` — cookies httpOnly (atualização, acesso) + cookie CSRF não-httpOnly, todos `secure`/`sameSite=lax`
- `csrf.ts` — geração e validação do token CSRF (double-submit cookie)
- `auditoria.ts` — registro de eventos (login, cadastro, logout) com IP/user-agent, best-effort
- `rateLimit.ts` — rate limiting por IP reaproveitando `LogAuditoria` (login, cadastro, recuperação de senha)
- `validacao.ts` — schemas Zod (cadastro, login, atualização, código MFA, verificação de e-mail, esqueci/redefinir senha)
- `clienteAuth.ts` — cliente client-side: cookies httpOnly (sem sessionStorage), refresh automático em 401, header CSRF automático, sessões, MFA e recuperação de senha
- `autenticar.ts` — helper que aceita o token via cookie httpOnly ou Bearer nas rotas

### Dados
- Prisma + **Postgres local** (`Usuario`, `TokenAtualizacao`, `LogAuditoria`), com campos de MFA (`mfaAtivado`, `mfaSecret`), `emailVerificado` e `papel` (enum `Papel`) — migrado de SQLite, dados existentes preservados

### Deploy em produção (Vercel)
- Dois projetos Vercel independentes, cada um com Postgres próprio via Marketplace (Neon): `auth-gateway` (Next.js, https://auth-gateway-kappa.vercel.app) e `auth-gateway-django` (Django, https://auth-gateway-django.vercel.app)
- Segredos de produção (chaves RS256, JWT secrets, `CRON_SECRET`, `DJANGO_SECRET_KEY`) gerados exclusivamente para produção — isolados do `.env` local
- `django/vercel.json` declara `config/wsgi.py` como entrypoint da function
- `DJANGO_SERVICE_URL` no projeto Next.js aponta para o projeto Django, testado ponta a ponta em produção (cadastro → login → rewrite autenticado até o Django)
- Detalhes completos e como reproduzir o deploy: seção "Deploy (Vercel)" do `README.md`

### Serviço de domínio (Django/DRF)
- Token de acesso migrado de HS256 para **RS256** (`src/lib/token.ts`) — chave privada só no Next.js, pública compartilhável com outros serviços; refresh e desafio MFA continuam HS256 (nunca saem do Next.js)
- `django/` — serviço Django REST Framework sem login próprio: `comum/autenticacao.py` valida o JWT (RS256, `algorithms` fixo, via header Bearer **ou** cookie `tokenAcesso`) e usa os claims `sub`/`papel` como identidade
- App `tarefas` com entidades reais: `Projeto` e `Tarefa` (status, prazo, relação por projeto), dados filtrados/gravados por `usuario_id` (o `sub` do token); rejeita criar tarefa em projeto de outro usuário
- `next.config.ts` encaminha `/api/dominio/*` para o Django via rewrite (mesma origem, sem CORS) — cookies (acesso e CSRF) são repassados transparentemente
- **Postgres compartilhado** — mesma instância local do Next.js, database própria (`autenticacao_dominio`)
- `ProtegidoContraCsrf` (`comum/autenticacao.py`) — mesma proteção CSRF double-submit-cookie do lado Next.js, aplicada nas mutações de `ProjetoViewSet`/`TarefaViewSet`
- **Testes automatizados** (`pytest-django`): `comum/tests/test_autenticacao.py` (token válido/expirado/adulterado/confusão de algoritmo/via cookie/claim `papel`) e `tarefas/tests/test_views.py` (CRUD + isolamento por usuário + CSRF ponta a ponta) — 23 testes

### Frontend
- Páginas: home, `/login` (com segunda etapa de código MFA e link "Esqueci minha senha"), `/cadastro`, `/dashboard` (protegida, com seções de Segurança: sessões ativas e MFA), `/verificar-email`, `/esqueci-senha`, `/redefinir-senha`
- `/dashboard/projetos` e `/dashboard/projetos/[id]` — CRUD de projetos e tarefas consumindo o serviço Django via rewrite (`src/lib/clienteDominio.ts`)
- `proxy.ts` faz checagem otimista de sessão via cookie e redireciona rotas protegidas/somente-visitante
- Sem `sessionStorage` — access token e CSRF token viajam via cookie, o cliente não guarda nenhum token manualmente
- `login`/`cadastro` com o mesmo padrão de formulário (`autoFocus`, `autoComplete`, `CampoSenha` compartilhado com mostrar/ocultar senha)

### Testes automatizados (Next.js)
- **Vitest contra servidor `next dev` real** (não mocka `next/headers`), database dedicada `autenticacao_test` na mesma instância Postgres, `tests/globalSetup.ts` sobe/derruba o servidor e aplica as migrations
- 28 testes em `tests/api/*.test.ts`: cadastro, login, sessões, MFA (códigos TOTP reais), RBAC, recuperação de senha, verificação de e-mail, CSRF e rate limiting

### Segurança já presente
- Senha hasheada (bcrypt)
- Refresh token hasheado no banco (não fica em texto puro)
- Rotação de refresh token
- Access token e refresh token em cookies **httpOnly** (não acessíveis a JavaScript — mitiga roubo via XSS)
- Access token de vida curta (15 min), assinado com RS256
- Proteção CSRF explícita (double-submit cookie) em toda mutação autenticada por cookie, Next.js e Django
- Verificação em duas etapas (TOTP) opcional por usuário
- Verificação de e-mail (token stateless, link logado no console em dev)
- RBAC mínimo (`Usuario.papel`, claim no token, rota de exemplo restrita a admin)
- Gestão de sessões ativas (listar/revogar individualmente ou todas de uma vez)
- Logs de auditoria (login sucesso/falha, cadastro, logout — IP e user-agent)
- Job de limpeza de tokens expirados/revogados antigos
- Segredos JWT gerados aleatoriamente (não mais placeholders) e documentados
- Recuperação de senha (token stateless, 1h, revoga todas as sessões ao redefinir, resposta anti-enumeração)
- Rate limiting por IP em login, cadastro e recuperação de senha (reaproveita `LogAuditoria`)

## 🔧 O que falta / pode fazer

Nenhum item pendente no momento — todos os itens de prioridade Alta e Média identificados neste roadmap foram entregues (ver "✅ Feito" acima). Itens fora de escopo intencional (rate limiting distribuído/Redis, captcha, envio real de e-mail) seguem documentados no `README.md`.

## 💡 Melhorias no que já existe

Todas as 5 identificadas foram aplicadas:

- ✅ **`atualizar/route.ts`** — erros inesperados do Prisma na transação de rotação agora são tratados/logados (`console.error` + `500` tratado).
- ✅ **`clienteAuth.ts` → `obterUsuarioAtual`** — a renovação automática agora é limitada a 1 tentativa (parâmetro `tentouRenovar`).
- ✅ **`dashboard/page.tsx`** — bloco que expunha o JWT de acesso na tela foi removido.
- ✅ **Mensagens de erro do login** — revisado, já seguia o padrão correto (não vaza se é e-mail ou senha errada).
- **`proxy.ts`** — mantido como está por decisão consciente: a doc oficial do Next.js 16 recomenda não usar o Proxy como solução completa de autorização/sessão; a validação real já acontece nas rotas de API (e agora também via CSRF explícito nas mutações).
