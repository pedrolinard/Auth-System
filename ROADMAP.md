# Roadmap — Sistema de Autenticação Intermediária

> Gerado em 2026-07-13. Atualizado em 2026-07-14 (todos os itens de prioridade Média entregues: verificação de e-mail, RBAC, sair de todos os dispositivos, access token em cookie httpOnly, CSRF explícito, logs de auditoria — além do serviço de domínio Django/DRF e das 5 melhorias anteriores). Cobre o que já foi implementado, o que falta fazer e melhorias sobre o que já existe.

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
- `GET /usuarios` — lista usuários, restrito a `papel = admin` (exemplo de RBAC)
- `POST /api/cron/limpar-tokens` — remove tokens expirados/revogados antigos, protegido por `CRON_SECRET`

### Lib (`src/lib/`)
- `token.ts` — geração/verificação de JWT (jose): acesso (RS256, inclui claim `papel`), atualização, desafio MFA e verificação de e-mail (cada um com segredo próprio), hash SHA-256 do refresh token
- `senha.ts` — hash/verificação de senha (bcryptjs)
- `mfa.ts` — geração de segredo TOTP, QR code (otpauth + qrcode) e verificação de código
- `sessao.ts` — emissão compartilhada de tokenAcesso/tokenAtualizacao/csrfToken em cookies httpOnly (usada por login e conclusão de MFA)
- `limpezaTokens.ts` — lógica de remoção de tokens expirados/revogados antigos
- `cookies.ts` — cookies httpOnly (atualização, acesso) + cookie CSRF não-httpOnly, todos `secure`/`sameSite=lax`
- `csrf.ts` — geração e validação do token CSRF (double-submit cookie)
- `auditoria.ts` — registro de eventos (login, cadastro, logout) com IP/user-agent, best-effort
- `validacao.ts` — schemas Zod (cadastro, login, atualização, código MFA, verificação de e-mail)
- `clienteAuth.ts` — cliente client-side: cookies httpOnly (sem sessionStorage), refresh automático em 401, header CSRF automático, sessões e MFA
- `autenticar.ts` — helper que aceita o token via cookie httpOnly ou Bearer nas rotas

### Dados
- Prisma + **Postgres local** (`Usuario`, `TokenAtualizacao`, `LogAuditoria`), com campos de MFA (`mfaAtivado`, `mfaSecret`), `emailVerificado` e `papel` (enum `Papel`) — migrado de SQLite, dados existentes preservados

### Serviço de domínio (Django/DRF)
- Token de acesso migrado de HS256 para **RS256** (`src/lib/token.ts`) — chave privada só no Next.js, pública compartilhável com outros serviços; refresh e desafio MFA continuam HS256 (nunca saem do Next.js)
- `django/` — serviço Django REST Framework sem login próprio: `comum/autenticacao.py` valida o JWT (RS256, `algorithms` fixo, via header Bearer **ou** cookie `tokenAcesso`) e usa os claims `sub`/`papel` como identidade
- App `tarefas` com entidades reais: `Projeto` e `Tarefa` (status, prazo, relação por projeto), dados filtrados/gravados por `usuario_id` (o `sub` do token); rejeita criar tarefa em projeto de outro usuário
- `next.config.ts` encaminha `/api/dominio/*` para o Django via rewrite (mesma origem, sem CORS) — cookies (acesso e CSRF) são repassados transparentemente
- **Postgres compartilhado** — mesma instância local do Next.js, database própria (`autenticacao_dominio`)
- `ProtegidoContraCsrf` (`comum/autenticacao.py`) — mesma proteção CSRF double-submit-cookie do lado Next.js, aplicada nas mutações de `ProjetoViewSet`/`TarefaViewSet`
- **Testes automatizados** (`pytest-django`): `comum/tests/test_autenticacao.py` (token válido/expirado/adulterado/confusão de algoritmo/via cookie/claim `papel`) e `tarefas/tests/test_views.py` (CRUD + isolamento por usuário + CSRF ponta a ponta) — 23 testes

### Frontend
- Páginas: home, `/login` (com segunda etapa de código MFA), `/cadastro`, `/dashboard` (protegida, com seções de Segurança: sessões ativas e MFA), `/verificar-email`
- `/dashboard/projetos` e `/dashboard/projetos/[id]` — CRUD de projetos e tarefas consumindo o serviço Django via rewrite (`src/lib/clienteDominio.ts`)
- `proxy.ts` faz checagem otimista de sessão via cookie e redireciona rotas protegidas/somente-visitante
- Sem `sessionStorage` — access token e CSRF token viajam via cookie, o cliente não guarda nenhum token manualmente

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

## 🔧 O que falta / pode fazer

| # | Item | Prioridade |
|---|------|------------|
| 1 | Revisar página de cadastro (confirmar mesmo padrão do login) | Alta |
| 2 | Recuperação de senha ("esqueci minha senha") | Alta |
| 3 | Testes automatizados (unitários/integração) das rotas de auth do Next.js (o lado Django já tem, ver acima) | Alta |
| 4 | Rate limiting / proteção contra força bruta (login, cadastro) | Alta |

Todos os itens de prioridade Média já foram entregues (verificação de e-mail, RBAC mínimo, sair de todos os dispositivos, access token em cookie httpOnly, CSRF explícito, logs de auditoria — ver "✅ Feito" acima). Restam só os 4 itens de prioridade Alta.

## 💡 Melhorias no que já existe

Todas as 5 identificadas foram aplicadas:

- ✅ **`atualizar/route.ts`** — erros inesperados do Prisma na transação de rotação agora são tratados/logados (`console.error` + `500` tratado).
- ✅ **`clienteAuth.ts` → `obterUsuarioAtual`** — a renovação automática agora é limitada a 1 tentativa (parâmetro `tentouRenovar`).
- ✅ **`dashboard/page.tsx`** — bloco que expunha o JWT de acesso na tela foi removido.
- ✅ **Mensagens de erro do login** — revisado, já seguia o padrão correto (não vaza se é e-mail ou senha errada).
- **`proxy.ts`** — mantido como está por decisão consciente: a doc oficial do Next.js 16 recomenda não usar o Proxy como solução completa de autorização/sessão; a validação real já acontece nas rotas de API (e agora também via CSRF explícito nas mutações).
