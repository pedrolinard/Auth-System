# Roadmap — Sistema de Autenticação Intermediária

> Gerado em 2026-07-13. Cobre o que já foi implementado, o que falta fazer e melhorias sobre o que já existe.

## ✅ Feito

### Backend / API (`src/app/api/auth/`)
- `POST /cadastro` — cria usuário com senha hasheada (bcrypt, 12 rounds), valida com Zod, trata e-mail duplicado (409)
- `POST /login` — valida credenciais, emite access token (JWT, 15 min) + refresh token (JWT, 30 dias), persiste hash do refresh token, seta cookie httpOnly
- `POST /atualizar` — renova tokens com **rotação de refresh token** (revoga o antigo, emite novo em transação), aceita token via cookie ou body
- `POST /logout` — revoga o refresh token no banco e limpa o cookie
- `GET /me` — retorna usuário autenticado via Bearer token

### Lib (`src/lib/`)
- `token.ts` — geração/verificação de JWT (jose), hash SHA-256 do refresh token
- `senha.ts` — hash/verificação de senha (bcryptjs)
- `cookies.ts` — cookie httpOnly/secure/sameSite=lax para o refresh token
- `validacao.ts` — schemas Zod (cadastro, login, atualização)
- `clienteAuth.ts` — cliente client-side: guarda access token em `sessionStorage`, refresh automático em 401
- `autenticar.ts` — helper para extrair/validar Bearer token nas rotas

### Dados
- Prisma + SQLite (`Usuario`, `TokenAtualizacao`), migração inicial aplicada

### Frontend
- Páginas: home, `/login`, `/cadastro`, `/dashboard` (protegida)
- `proxy.ts` faz checagem otimista de sessão via cookie e redireciona rotas protegidas/somente-visitante

### Segurança já presente
- Senha hasheada (bcrypt)
- Refresh token hasheado no banco (não fica em texto puro)
- Rotação de refresh token
- Cookie httpOnly
- Access token de vida curta (15 min)

## 🔧 O que falta / pode fazer

| # | Item | Prioridade |
|---|------|------------|
| 1 | Revisar página de cadastro (confirmar mesmo padrão do login) | Alta |
| 2 | Verificação de e-mail | Média |
| 3 | Recuperação de senha ("esqueci minha senha") | Alta |
| 4 | Rate limiting / proteção contra força bruta (login, cadastro) | Alta |
| 5 | Endpoint "sair de todos os dispositivos" (revogar todos os tokens do usuário) | Média |
| 6 | Gestão de sessões múltiplas (listar/revogar sessões individualmente) | Baixa |
| 7 | Proteção CSRF explícita nas mutações sensíveis | Média |
| 8 | Repensar armazenamento do access token (sessionStorage é vulnerável a XSS) | Média |
| 9 | Job de limpeza de tokens expirados/revogados | Baixa |
| 10 | Logs de auditoria (login sucesso/falha, IP, user-agent) | Média |
| 11 | Testes automatizados (unitários/integração) das rotas de auth | Alta |
| 12 | Documentar geração de segredos JWT fortes para produção | Baixa |
| 13 | 2FA/MFA | Baixa |
| 14 | RBAC (papéis/permissões) — necessário se for gateway para outras apps | Média |

## 💡 Melhorias no que já existe

- **`atualizar/route.ts`** — garantir tratamento/log de erros inesperados do Prisma na transação de rotação.
- **`clienteAuth.ts` → `obterUsuarioAtual`** — a recursão após refresh pode entrar em loop se o refresh funcionar mas `/me` continuar falhando por outro motivo (ex. 500); limitar a 1 retry.
- **`dashboard/page.tsx`** — expõe o JWT de acesso na tela; ok para debug, remover antes de produção real.
- **Mensagens de erro do login** já evitam vazar se é e-mail ou senha errada (bom padrão) — manter em outros pontos.
- **`proxy.ts`** — checagem é otimista (só valida assinatura, não revogação); considerar validar contra o banco em rotas realmente sensíveis.
