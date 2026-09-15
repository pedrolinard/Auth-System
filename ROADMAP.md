# Roadmap — Sistema de Autenticação Intermediária

> Gerado em 2026-07-13. Atualizado em 2026-07-16 (índice composto em `LogAuditoria` pra acelerar as consultas do rate limit). Atualizado em 2026-07-14 (todos os itens de prioridade Alta e Média entregues: paridade da página de cadastro, recuperação de senha, testes automatizados das rotas de auth do Next.js, rate limiting, verificação de e-mail, RBAC, sair de todos os dispositivos, access token em cookie httpOnly, CSRF explícito, logs de auditoria — além do serviço de domínio Django/DRF e das 5 melhorias anteriores). **Nenhum item pendente no momento.** Sistema em produção na Vercel desde 2026-07-14 (ver seção "Deploy em produção" abaixo).
>
> Atualizado em 2026-08-31 (varredura de segurança — 1ª leva: senha na troca de e-mail, `userVerification: required` nas passkeys, `.max` no nome, CSP libera Rollbar, hardening do Django, upgrade de deps com CVE. 2ª leva: export LGPD exige senha + vira POST, limite por e-mail no `esqueci-senha`, `iss`/`aud` no access token, retenção da auditoria, CSP com `object-src 'none'`, export de auditoria em PDF). A fonte única de verdade do roadmap agora é `src/data/roadmap.ts` (renderizada em `/roadmap`); este arquivo é um retrato resumido.
>
> Atualizado em 2026-09-14 (Turnstile ativado em produção com chaves reais da Cloudflare; corrigido também um `.vercelignore` desatualizado que fazia `vercel deploy` local subir `node_modules`/`.next` inteiros por ignorar o `.gitignore`. Depois: contador de rate limit dedicado — tabela `limites_taxa` substitui o `count()` sobre `LogAuditoria`. Depois: observabilidade no Django — recurso Rollbar próprio via Vercel Marketplace + `RollbarNotifierMiddleware`, fechando o último item pendente da varredura de 08-31 que não era um trade-off deliberado. Depois: integrações Neon desconectadas dos dois projetos (rollback pós-migração pro Supabase, confirmado estável) — achado no processo: a seção "Deploy (Vercel)" do `README.md` ainda dizia que o Django "continua na Neon", desatualizada desde a migração de 08-29; corrigida. Depois: **multi-tenant (organizações)** — `Organizacao`/`Membro`/`ConviteOrganizacao` novos, organização ativa vira claim no access token (`organizacaoId`/`papelOrganizacao`), troca de organização sem reautenticar, Django isolado por `organizacao_id`, RBAC de admin escopado por organização (não mais só o `papel` de sistema), convites por e-mail com aceite idempotente, seletor de organização e tela `/dashboard/organizacoes` no frontend — implementado em 5 fases, cada uma revisada e corrigida antes da próxima. Depois: achado no processo de deploy — os dois endpoints de autoatendimento LGPD (`/minha-conta/exportar` e `/minha-conta` DELETE) tinham ficado pra trás do multi-tenant: o export não incluía organizações/convites, e excluir a própria conta deixava a organização pessoal órfã (Membro cascade-deleta, Organizacao não) e não bloqueava quem era única pessoa dona de uma organização com outros membros; os dois corrigidos. **Implantado em produção em 2026-09-08** — o deploy tinha ficado 7 dias em `ERROR` sem ninguém notar: o `next build` morre em "Collecting page data" porque `src/lib/token.ts` faz `throw` na avaliação do módulo quando falta qualquer segredo, e a `JWT_CONVITE_ORGANIZACAO_SECRET` (nova, do multi-tenant) nunca foi criada no ambiente de produção — o CI do GitHub Actions passava verde porque lá a variável existe. Como o `npm run build` roda `prisma migrate deploy` ANTES do `next build`, os builds que falharam já tinham aplicado as migrations: produção ficou com schema novo e código velho. Destravado na ordem schema → dados → código nos dois serviços (backfill do Next.js: 3 organizações criadas; migrate + backfill do Django: 0 falhas). Depois: **Fase 00 do provedor (identidade por aplicação + JWKS)** — `Aplicacao` e `ChaveAssinatura` novos, e-mail único por aplicação em vez de global, `kid` no access token, `/.well-known/jwks.json`, Django validando por JWKS, rate limit e passkeys escopados por aplicação, rotação de chave sem deploy coordenado. Implementado na branch `fase-00-identidade-por-aplicacao` e **implantado em produção em 2026-09-08** (Next.js 17:40, Django 17:41), junto com a correção do incidente descrita a seguir. Depois, no mesmo dia: **incidente e correção de causa raiz** — o build de *preview* do PR da Fase 00 aplicou as migrations no banco de **produção** (Preview e Production dividem a mesma instância Supabase, e `prisma migrate deploy` rodava dentro do `build`, antes do `next build`); produção ficou com schema novo e código velho e o cadastro caiu com 500 até o merge. O `build` agora roda `scripts/checar-migrations.mjs`, que **verifica e nunca aplica**: em Production, migration pendente ou banco inacessível interrompe o build; em Preview e local, avisa e segue. Aplicar migration virou passo deliberado, igual ao lado Django. Contagens de teste: **236 no total** — 194 Vitest + 6 E2E Playwright + 36 Django.
>
> Atualizado em 2026-09-15: suspensão por organização, cadastro sem enumeração, CSP com nonce e gestão de aplicações (14/09); depois, pente fino no projeto inteiro e o que falta de código para vender — autenticação da aplicação cliente, CORS, SDK, e-mails com marca, endpoint de saúde e documentos de operação, segurança e jurídico. Ver "Pente fino" e "Pronto para integrar" abaixo.

## ✅ Feito

### Backend / API (`src/app/api/auth/`)
- `POST /cadastro` — cria usuário com senha hasheada (bcrypt, 12 rounds), valida com Zod; gera token de verificação de e-mail (link logado no console) e registra auditoria. **Anti-enumeração**: e-mail já cadastrado recebe a mesma resposta (201, mesmo corpo) de um cadastro novo, e o dono do endereço recebe um e-mail avisando da tentativa, com os links de login e recuperação (teto de 3 avisos/h por endereço)
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
- `POST /usuarios/[id]/suspender`, `POST /usuarios/[id]/reativar` — suspende/reativa um membro **dentro da organização ativa** (dono/admin); a pessoa segue entrando nas outras organizações
- `GET /aplicacoes`, `POST /aplicacoes`, `PATCH /aplicacoes/[id]`, `POST /aplicacoes/[id]/segredo` — gestão das aplicações clientes do provedor (ver "Gestão de aplicações" abaixo), restrita a quem opera o provedor

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
- **Testes automatizados** (`pytest-django`): `comum/tests/test_autenticacao.py` (token válido/expirado/adulterado/confusão de algoritmo/via cookie/claims `papel`/`organizacao_id` + `ProtegidoContraCsrf` em tempo constante) e `tarefas/tests/test_views.py` (CRUD + isolamento por organização + CSRF ponta a ponta) e `comum/tests/test_saude.py` (migration pendente responde 503) e `comum/tests/test_limites.py` (limite por usuário, TLS do banco) — 46 testes

### Multi-tenant (organizações)
> Implementado em 5 fases (schema/backfill → sessão/token → Django → RBAC → convites/UI), cada fase revisada e corrigida antes da seguinte. **Em produção desde 2026-09-08** — ver a nota do cabeçalho sobre os 7 dias de deploy quebrado.
- Modelo "Slack-style": uma conta pode ser membro de várias organizações, com um papel próprio por organização (`dono`/`admin`/`membro`, em `Membro.papel`) — independente do `papel` de sistema (`usuario`/`admin`, em `Usuario.papel`) que já existia e continua só pro painel de auditoria
- A organização **ativa** da sessão é um claim no próprio access token (`organizacaoId`/`papelOrganizacao`), não resolvida por parâmetro de rota a cada requisição — decisão deliberada pra preservar o princípio de que o Django nunca consulta as tabelas do Next.js, só confia no JWT
- Trocar de organização ativa (`POST /api/auth/organizacoes/[id]/entrar`) reemite tokens sem pedir senha de novo, mesmo padrão que a conclusão de MFA já usa; trade-off aceito: uma organização ativa por sessão de navegador (trocar numa aba troca em todas)
- Django isolado por `organizacao_id`: `Projeto`/`Tarefa` só aparecem pra quem é membro da mesma organização; sessão sem organização ativa é rejeitada (403) em vez de vazar linhas órfãs pra quem estiver sem organização
- RBAC de admin (listar/suspender/reativar/remover membro) escopado por organização — dono/admin da organização A não enxerga nem afeta contas da organização B; desde 2026-09-14 a **suspensão também é por organização** (`Membro.suspenso`): login abre na primeira organização em que a pessoa não está suspensa e só é recusado se ela estiver suspensa em todas
- Convites por e-mail: token JWT stateless com segredo próprio (`JWT_CONVITE_ORGANIZACAO_SECRET`), reconvidar o mesmo e-mail atualiza o convite pendente em vez de duplicar, aceite exige estar autenticado com a conta dona do e-mail convidado e é idempotente sob aceite concorrente (corrida tratada, sem 500)
- Rate limit dedicado: criar organização (10/h por IP) e enviar convite (30/h por IP + 5/h por e-mail alvo), mesmo padrão do resto do projeto
- Cadastro cria a organização pessoal do usuário numa transação (`Usuario` + `Organizacao` + `Membro` dono) — sem organização órfã se algo falhar no meio
- Frontend: seletor de organização ativa no `NavPainel`, `/dashboard/organizacoes` (criar organização, convidar/revogar convite) e `/aceitar-convite` (estado autenticado e não-autenticado)
- Backfill (`scripts/backfill-organizacoes.mjs` + `django/scripts/backfill_organizacoes.py`) cria a organização pessoal de cada conta pré-existente e reatribui `Projeto`/`Tarefa` antigos — idempotente, rodado em produção em 2026-09-08 (3 organizações criadas no lado Next.js, 0 falhas nos dois lados)
- Autoatendimento LGPD atualizado: o export (`POST /minha-conta/exportar`) agora inclui as organizações de que a pessoa é membro e os convites que ela criou; excluir a própria conta (`DELETE /minha-conta`) apaga junto a organização pessoal órfã (Membro cascade-deleta, Organizacao sozinha não) e bloqueia (409) quem é a única pessoa dona de uma organização com outros membros — mesma trava que já existia na remoção feita por um admin

### Identidade por aplicação (Fase 00 do provedor)
> Primeira fase de virar o sistema num provedor de auth vendável, em vez do auth de um app só. **Em produção desde 2026-09-08.**
- `Aplicacao` — o cliente que integra: `clientId` público (header `x-aplicacao-id`, seleciona o tenant mas nunca autoriza), segredo hasheado, lista de origens permitidas, RP ID de passkey, flag `padrao`
- `ChaveAssinatura` — conjunto de chaves RS256 com `kid`, privada cifrada em repouso (AES-256-GCM, mesma função usada no segredo TOTP); substitui a chave única em variável de ambiente
- **E-mail único por aplicação** (`@@unique([aplicacaoId, email])`) em vez de único no sistema — é o índice que separa "auth do meu app" de "auth como serviço"; slug de organização idem
- `GET /.well-known/jwks.json` — chaves públicas publicadas; o Django deixou de ter chave estática e passou a resolver por `kid` (`PyJWKClient` com cache), então rotacionar não exige mais deploy sincronizado dos dois serviços
- `aud` de volta no access token, agora como a aplicação — o claim removido em 01/09 por quebrar um consumidor, reintroduzido junto com o mecanismo que torna a mudança segura
- Rate limit por e-mail passou a levar a aplicação na chave: sem isso um cliente trancava o usuário do outro só martelando o mesmo endereço
- Passkeys por aplicação: RP ID e origens eram env vars globais, e uma credencial WebAuthn só vale na origem em que nasceu — com clientes em domínios próprios não dá pra ter um RP ID só
- Auditoria escopada por `aplicacaoId`: um admin vê a trilha da própria aplicação, nunca a dos outros clientes
- Requisição sem header cai na **aplicação padrão** — é o que manteve todo o front existente funcionando sem reescrever nenhuma tela
- `scripts/backfill-aplicacoes.mjs` (cria a aplicação padrão, atribui as linhas existentes, importa a chave do ambiente) e `scripts/rotacionar-chave-assinatura.mjs` (gerar → ativar → remover, na ordem que não derruba sessão)
- A migration destrutiva faz o próprio backfill em SQL, idempotente: o build da Vercel aplica todas as migrations pendentes de uma vez, então depender de um script externo ter rodado no meio quebraria o deploy — a lição de 08/09 aplicada como código

### Gestão de aplicações (Fase 01 do provedor)
> Implementada em 2026-09-14. Antes, criar uma aplicação cliente era INSERT à mão no banco.
- `/dashboard/aplicacoes` + `/api/auth/aplicacoes`: criar, editar (nome, origens, RP ID de passkey), desativar/reativar e rotacionar o `clientSecret`
- Acesso só pra quem **opera o provedor**: admin de sistema com conta na aplicação padrão — um admin de sistema dentro de uma aplicação cliente não enxerga as outras (`src/lib/gestaoAplicacoes.ts`)
- `clientSecret` mostrado uma única vez, gravado só como hash SHA-256; rotacionar invalida o anterior na hora
- Validação contra configuração que nunca funciona: origem só esquema+host, `http` só em localhost, RP ID precisa cobrir todas as origens (regra do WebAuthn); trocar o RP ID com passkeys registradas é recusado (409)
- Sem exclusão (o `Restrict` nas contas é proposital); desativar derruba na hora as sessões dos usuários finais daquela aplicação; a aplicação padrão não pode ser desativada
- Ainda não feito: nenhuma rota exige o `clientSecret` (ver "O que falta")

### Frontend
- Páginas: home, `/login` (com segunda etapa de código MFA e link "Esqueci minha senha"), `/cadastro`, `/dashboard` (protegida, com seções de Segurança: sessões ativas e MFA), `/verificar-email`, `/esqueci-senha`, `/redefinir-senha`
- `/dashboard/projetos` e `/dashboard/projetos/[id]` — CRUD de projetos e tarefas consumindo o serviço Django via rewrite (`src/lib/clienteDominio.ts`)
- `/dashboard/organizacoes` e `/aceitar-convite` — gestão de organizações e aceite de convite (ver "Multi-tenant" acima)
- `/dashboard/aplicacoes` — gestão das aplicações clientes, visível só pra quem opera o provedor (ver "Gestão de aplicações" acima)
- `proxy.ts` faz checagem otimista de sessão via cookie e redireciona rotas protegidas/somente-visitante, e monta o CSP de cada página com um nonce novo por requisição (`src/lib/csp.ts`)
- Sem `sessionStorage` — access token e CSRF token viajam via cookie, o cliente não guarda nenhum token manualmente
- `login`/`cadastro` com o mesmo padrão de formulário (`autoFocus`, `autoComplete`, `CampoSenha` compartilhado com mostrar/ocultar senha)

### Testes automatizados (Next.js)
- **Vitest contra servidor `next dev` real** (não mocka `next/headers`), database dedicada `autenticacao_test` na mesma instância Postgres, `tests/globalSetup.ts` sobe/derruba o servidor e aplica as migrations
- 248 testes em `tests/api/*.test.ts`, `tests/lib/*.test.ts` e `tests/sdk/*.test.ts` (SDK contra o servidor real): autenticação da aplicação cliente e CORS, motivo de revogação e renovação concorrente, cadastro (incluindo anti-enumeração), gestão de aplicações, suspensão por organização, CSP com nonce, login, sessões, MFA (códigos TOTP reais e backup), RBAC (sistema e por organização), recuperação/troca/alteração de e-mail e senha, verificação de e-mail, CSRF, rate limiting, viagem impossível, passkeys, organizações/convites, cron de limpeza, criptografia em repouso e comparação em tempo constante
- 8 testes E2E de navegador (Playwright): cadastro/login, dashboard protegido, passkeys via virtual authenticator, login com código de backup e renovação de sessão com várias abas

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
- Access token carrega `iss`, validado no Next.js e no Django (`options={require:[exp,iss]}`), e `aud` = a aplicação — removido em 2026-09-01 por quebrar um consumidor, reintroduzido na Fase 00 junto com `kid` + JWKS (ver "Identidade por aplicação")
- Retenção da trilha de auditoria: `POST /api/cron/limpar-tokens` poda `LogAuditoria` > 365 dias e `DesafioMfaConsumido` expirado (índice `criadoEm` novo)
- CSP com `object-src 'none'` e `upgrade-insecure-requests`
- **CSP sem `'unsafe-inline'` em `script-src`** (2026-09-14): nonce por requisição + `'strict-dynamic'` nas páginas, política fechada (`default-src 'none'`) nas rotas de API. Toda página passa a renderizar por requisição (`await connection()` no layout raiz), custo aceito. Verificado num build de produção: todo `<script>` sai com o nonce, zero violações no Chromium, Turnstile carregando sob o CSP novo
- Sessão revogada administrativamente (suspender/remover de organização, desativar aplicação) não dispara mais a detecção de **reuso de refresh token** — antes, renovar a sessão de uma organização da qual a pessoa foi removida derrubava as sessões dela em todas as outras e mandava um alerta falso de invasão
- Exportação da auditoria em PDF pra admins (jsPDF carregado sob demanda no clique)
- CAPTCHA (Turnstile) ativo em produção: `TURNSTILE_SECRET_KEY`/`NEXT_PUBLIC_TURNSTILE_SITE_KEY` configuradas na Vercel — fricção progressiva a partir da 5ª falha de login/cadastro por IP passa a exigir o desafio de verdade (fail-closed, confirmado em prod)
- Contador de rate limit dedicado (`limites_taxa`): uma linha por chave (ip/e-mail + evento), incrementada com `INSERT ... ON CONFLICT DO UPDATE` em janela fixa — substitui o `count()` sobre `LogAuditoria` que rodava a cada tentativa de login/cadastro/redefinição; `LogAuditoria` segue intacta para auditoria e detecção de dispositivo novo
- Observabilidade no Django: recurso Rollbar próprio (Vercel Marketplace, projeto `auth-gateway-django`) + `RollbarNotifierMiddleware` — mesmo provedor do Next.js, um 500 não tratado no serviço de domínio agora chega ao mesmo dashboard

### Pente fino (2026-09-15)
Leitura do projeto inteiro (lib, rotas, telas críticas, Django, scripts, CI, configuração). Corrigido, cada um com teste de regressão:
- **Aceitar convite** deixava uma conta de outra aplicação entrar na organização (o e-mail só é único por aplicação)
- **Chave pública removida** do JWKS seguia aceita em instâncias aquecidas (cache sem expiração)
- **CSRF** era dispensado quando só o cookie CSRF faltava, mesmo com cookie de sessão — Next.js e Django
- **Reconfirmar o MFA** gerava mais 10 códigos de backup sem invalidar os antigos
- **MFA e código de backup** concluíam login em aplicação desativada durante o desafio
- **Alarme de reuso de token** disparava em revogações legítimas (troca de senha em outro aparelho, logout, limite de sessões, suspensão), derrubando a sessão nova da pessoa e mandando alerta falso. Toda revogação grava o motivo; só a rotação conta como roubo
- **Renovação concorrente** do mesmo token abria duas sessões e podia sobrescrever uma suspensão. Rotação só com o token ativo; o navegador serializa renovações entre abas (Web Locks)
- **Tela de login sem código de backup:** a API existia e os códigos não serviam pra entrar
- **`/roadmap` público** expunha contagem de contas, admins e sessões de produção
- **Conta sem organização** dava 500 sem corpo no login (caso real em produção). Agora ganha a organização pessoal; `backfill-organizacoes.mjs` voltou a funcionar depois da Fase 00
- **Erro 500 cru na tela** ("Unexpected end of JSON input") — os clientes do navegador leem corpo vazio com segurança
- 500 em aceitar convite estando suspenso, verificar e-mail de conta excluída, passkey duplicada e `?projeto=abc` no Django
- Datas deslocadas em Postgres fora de UTC (sessão do banco agora sempre em UTC)
- Rewrite do Django inválido sem `DJANGO_SERVICE_URL` quebrava todo build de Preview
- Exclusão de conta sumia da auditoria do cliente; "sair de todos os dispositivos" não era auditado; sem aviso de `EMAIL_FROM` no sandbox do Resend
- Limpeza: `.gitignore` duplicado (a última linha re-ignorava o `.env.example`), comentários desatualizados, testes dependentes de contadores de rate limit persistidos, 3.093 organizações órfãs no banco de teste

### Pronto para integrar (2026-09-15)
- **Autenticação da aplicação cliente:** navegador precisa de origem cadastrada (lista vazia recusa); servidor precisa do client secret (`x-aplicacao-segredo`)
- **CORS** por aplicação no `proxy.ts`, sem liberar o header do segredo nem cookies entre domínios; JWKS público
- **Logout** aceita o refresh token no corpo
- **SDK** em `sdk/` (cliente JS + verificador de token de backend) e guia em `docs/integracao.md`
- **E-mails com a marca** da aplicação: nome no assunto, remetente, logo e endereço dos links configuráveis
- **`GET /api/saude`** para monitoramento
- **Documentos para venda:** `docs/operacao.md` (infraestrutura), `docs/seguranca/escopo-pentest.md`, `docs/juridico/` (rascunhos para advogado)

### Revisão de segurança, front end e infraestrutura (2026-09-15)
- **Resposta perdida virava "roubo":** reapresentar um refresh token rotacionado há menos de 30 s (retentativa de rede) só é recusado, sem derrubar as sessões nem mandar alerta
- **SDK deslogava as abas** com armazenamento persistente: Web Locks entre instâncias, releitura do armazenamento e limpeza só se o token guardado ainda for o enviado
- **Client secret errado passava** junto de uma Origin cadastrada: o segredo decide sempre que vier; o guia deixou claro que a origem não barra script
- **IP do usuário final** (`x-usuario-ip`) aceito só com o client secret conferido — antes todos os usuários de uma integração pelo servidor dividiam limite e captcha
- **MFA com limite por conta** (10 falhas em 15 min), além do por IP — fecha a força bruta distribuída dos códigos
- **Sitekey do Turnstile** na resposta de captcha e passo de liberar o domínio do cliente na Cloudflare
- **Limpeza agendada de verdade** (`vercel.json`, Vercel Cron diário) — antes nada chamava a rota em produção
- **Monitor de saúde** (`.github/workflows/monitor-saude.yml`) a cada 15 min
- **Limite de requisições no Django** (300/min por usuário, por instância)
- **`DATABASE_CA_CERT`** (Next.js e Django) para TLS com verificação do certificado do banco; `DATABASE_POOL_MAX` opcional
- **Esqueleto de carregamento** na navegação do painel

### Rumo à venda (2026-09-16)
- **Webhooks por aplicação:** 9 eventos de conta, assinatura HMAC com timestamp, retentativas com espera crescente, desligamento após falhas seguidas, anti-SSRF (https/443, IPs internos bloqueados, sem rebinding nem redirect); só aplicação aprovada
- **Login hospedado com OpenID Connect:** discovery, `/autorizar`, `/api/oidc/token` e `/api/oidc/userinfo`; PKCE S256 obrigatório, redirect_uri exato, código de 60 s de uso único (reuso derruba a sessão), id_token RS256 com nonce, só pra aplicação aprovada; sem SSO nesta versão
- **Aplicações self-service:** dono/admin de organização do painel com e-mail verificado cria e gerencia as aplicações da própria organização (até 3); operador vê todas e é o único que define remetente próprio
- **Auditoria com alvo:** eventos de gestão de aplicações dizem qual aplicação foi alterada (`LogAuditoria.alvo`)
- **Exclusão dos dados do Django junto com a organização (LGPD):** fila na mesma transação + `POST /api/dominio/interno/excluir-dados` (organizações apagadas e registros legados da conta sem organização) com token de serviço RS256 de audiência própria; o job diário reenvia o que falhou

## 🔧 O que falta / pode fazer

Os itens em aberto da varredura de segurança de 2026-08-31 (CSP com `'unsafe-inline'`, enumeração no cadastro) e o trade-off do multi-tenant (suspensão por conta inteira) foram resolvidos em 2026-09-14 — ver as seções acima.

Em aberto:

- **Infraestrutura para cliente pagante** — domínio próprio, e-mail verificado, planos pagos, backup testado, alertas. Não é código: `docs/operacao.md`.
- **Pentest externo e revisão jurídica** — escopo em `docs/seguranca/escopo-pentest.md`, rascunhos em `docs/juridico/`.
- **Ligar TLS verificado no banco e separar o usuário do Django** — o código aceita `DATABASE_CA_CERT`, mas ligar exige testar o certificado contra o pooler antes; SQL do usuário separado em `docs/operacao.md`, itens 7 e 8.
- **Banco próprio pro ambiente Preview** — banco criado e migrado; falta semear, apontar o `DATABASE_URL` do Preview e criar as env vars (`docs/operacao.md`, item 6).
- **Remover as colunas de suspensão legadas de `Usuario`** — ficaram sem uso, de propósito, pra não quebrar o login na janela entre a migration e o deploy; saem num deploy posterior.
- **Auditoria da gestão de aplicações sem o alvo** — os eventos registram quem agiu, mas `LogAuditoria` não tem campo pra dizer qual aplicação foi alterada.
- **Publicar o SDK no npm** — hoje é consumido direto da fonte.

Itens fora de escopo intencional (rate limiting distribuído/Redis, envio real de e-mail) seguem documentados no `README.md`.

## 💡 Melhorias no que já existe

Todas as 5 identificadas foram aplicadas:

- ✅ **`atualizar/route.ts`** — erros inesperados do Prisma na transação de rotação agora são tratados/logados (`console.error` + `500` tratado).
- ✅ **`clienteAuth.ts` → `obterUsuarioAtual`** — a renovação automática agora é limitada a 1 tentativa (parâmetro `tentouRenovar`).
- ✅ **`dashboard/page.tsx`** — bloco que expunha o JWT de acesso na tela foi removido.
- ✅ **Mensagens de erro do login** — revisado, já seguia o padrão correto (não vaza se é e-mail ou senha errada).
- **`proxy.ts`** — mantido como está por decisão consciente: a doc oficial do Next.js 16 recomenda não usar o Proxy como solução completa de autorização/sessão; a validação real já acontece nas rotas de API (e agora também via CSRF explícito nas mutações).
