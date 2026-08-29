// Fonte única de verdade do roadmap público (`/roadmap`). Ao entregar (ou
// descartar conscientemente) um item de `proximosPassos`, atualize o
// `status`/`concluidoEm` dele (e mova um resumo pra `concluido`, se fizer
// sentido pra um item "feito") NO MESMO COMMIT que entrega a mudança de
// código — como a Vercel faz deploy automático a cada push na `main`, a
// página pública já sobe atualizada no próximo deploy, sem precisar de
// nenhum passo manual de "regenerar o roadmap" (era exatamente esse passo
// manual, sempre esquecido, que deixava o antigo public/roadmap.html e o
// ROADMAP.md desatualizados).

export type PrioridadeRoadmap = "alta" | "media" | "baixa";
// "descartado": decisão consciente registrada de NÃO fazer (por ora) — não é
// "pendente" (não está na fila) nem "feito" (nada foi construído). Existe pra
// fechar um item do roadmap sem fingir que virou código.
export type StatusRoadmap = "pendente" | "feito" | "descartado";

export type ItemProximoPasso = {
  id: string;
  titulo: string;
  descricao: string;
  categoria: string;
  prioridade: PrioridadeRoadmap;
  status: StatusRoadmap;
  /** YYYY-MM-DD — preenchido quando status vira "feito" ou "descartado". */
  concluidoEm?: string;
};

export type GrupoConcluido = {
  categoria: string;
  itens: string[];
};

export const atualizadoEm = "2026-08-29";

// Métricas ESTÁTICAS do código — atualize junto com a mudança que as move
// (mesma disciplina do resto do arquivo). As métricas AO VIVO (contagens do
// banco, commit/deploy) são calculadas em tempo de requisição na página.
export const metricas = {
  rotasApi: 33,
  migracoesPrisma: 15,
  modulosLib: 28,
  tabelas: 7,
  testesVitest: 146,
  testesE2e: 6,
  testesDjango: 23,
};

export const concluido: GrupoConcluido[] = [
  {
    categoria: "Cadastro & login",
    itens: [
      "Senha com hash bcrypt (12 rounds), limite de 72 bytes UTF-8 no schema Zod contado em bytes, não em caracteres (senão acentos/emoji furariam o limite e o bcryptjs truncaria em silêncio)",
      "bcrypt.compare roda mesmo com e-mail inexistente (hash falso fixo) — sem side-channel de timing pra enumerar contas",
      "Verificação de e-mail por link com token stateless, reenvio protegido por rate limit",
      "Recuperação de senha: token de 1h, resposta genérica anti-enumeração, revoga todas as sessões ao redefinir",
      "Checagem de senha vazada (Have I Been Pwned, k-anonymity) no cadastro e na redefinição de senha — recusa senhas já conhecidas em vazamentos reais",
      "Troca de senha estando logado (PUT /api/auth/senha), exigindo a senha atual — mantém a sessão de origem viva e derruba as demais",
      "Alterar e-mail com confirmação em duas etapas — o endereço só muda depois de um link clicado no e-mail NOVO; o e-mail ANTIGO recebe aviso de segurança, o link é de uso único e confirmar a troca revoga todas as sessões e dispositivos confiáveis (mesma proteção da redefinição de senha)",
    ],
  },
  {
    categoria: "Tokens & sessões",
    itens: [
      "Access token RS256 de vida curta (15 min) + refresh token HS256 de longa duração (30 dias), ambos em cookies httpOnly",
      "Rotação de refresh token a cada renovação, com detecção de reuso (revoga a família inteira de sessões)",
      "Sessões ativas: listar, revogar uma ou todas de uma vez (\"sair de todos os dispositivos\")",
      "Sessões mostram tipo de dispositivo (desktop/tablet/mobile) e localização aproximada (cidade/UF/país via headers de geo da Vercel)",
      "Logout automático após 5 min de inatividade no dashboard, revogando a sessão de verdade no banco",
      "Limite de 5 sessões simultâneas por usuário — a mais antiga é revogada automaticamente ao passar do limite",
    ],
  },
  {
    categoria: "Verificação em duas etapas (MFA)",
    itens: [
      "TOTP (Google Authenticator/Authy/1Password) com QR code, segredo cifrado em repouso (AES-256-GCM)",
      "Bloqueio de replay de código TOTP e desafio de MFA de uso único",
      "10 códigos de backup (recovery codes) por ativação, hash SHA-256, uso único, regeneração exige reautenticação",
      "Rotação de MFA_ENCRYPTION_KEY sem downtime (fallback de leitura pra chave anterior)",
      "\"Lembrar este dispositivo\" por 30 dias — pula o desafio de MFA em navegadores já verificados (a senha continua sendo exigida sempre)",
    ],
  },
  {
    categoria: "Proteção contra automação",
    itens: [
      "Rate limiting por IP e por conta em login, cadastro e recuperação de senha (reaproveita LogAuditoria)",
      "CAPTCHA (Cloudflare Turnstile) como fricção progressiva antes do bloqueio duro",
      "Limite de IP generoso (20 tentativas/15 min) pra não travar redes compartilhadas — CAPTCHA e limite por conta seguram a barra de verdade",
      "IP extraído de x-vercel-forwarded-for / x-real-ip (a Vercel controla, cliente não forja); o x-forwarded-for cru só como fallback de dev, porque na Vercel o item à esquerda é controlado pelo cliente",
    ],
  },
  {
    categoria: "Contas & RBAC",
    itens: [
      "RBAC mínimo (usuario/admin) como claim no token de acesso",
      "Admin pode suspender (temporária ou permanente) ou excluir permanentemente a conta de outro usuário",
      "Suspensão revoga todas as sessões ativas na hora e bloqueia login imediatamente",
      "Auditoria de ações administrativas registra também QUEM (qual admin) suspendeu/reativou/excluiu, não só o alvo",
      "Autoatendimento LGPD: GET/DELETE /api/auth/minha-conta — o próprio titular exporta os dados que o serviço guarda sobre ele (dados pessoais, sessões, dispositivos confiáveis, códigos de backup, passkeys, auditoria) ou exclui a conta (exige senha atual, mesma fricção da troca de senha)",
      "E-mails de segurança: dispositivo novo, MFA ativado/desativado, senha alterada, códigos de backup regenerados, reuso de refresh token detectado, viagem impossível (login em país diferente do último, tempo curto demais pra ser real)",
    ],
  },
  {
    categoria: "Auditoria & operação",
    itens: [
      "Logs de auditoria (login sucesso/falha, cadastro, logout, IP e user-agent)",
      "Painel de auditoria para admins (/dashboard/auditoria) — consulta os últimos 200 logs com filtro por evento/e-mail, sem precisar acessar o banco direto",
      "Proteção CSRF explícita (double-submit cookie) em toda mutação autenticada por cookie",
      "Headers de segurança HTTP (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Permissions-Policy)",
      "Job de limpeza de tokens expirados/revogados antigos, protegido por CRON_SECRET",
      "Checagem de config de produção no boot (src/instrumentation.ts → register): aborta o boot se BASE_URL faltar ou o Turnstile estiver configurado pela metade; loga aviso pra degradações toleráveis (sem Resend, sem Rollbar, sem CRON_SECRET)",
      "Todas as colunas de data usam timestamptz — elimina ambiguidade de fuso horário entre o runtime da Vercel (UTC) e leituras de outros fusos",
    ],
  },
  {
    categoria: "Serviço de domínio (Django/DRF)",
    itens: [
      "Valida o mesmo token de acesso (RS256) do Next.js, sem login próprio nem model de usuário",
      "Entidades reais (Projeto/Tarefa) isoladas por usuário, mesma proteção CSRF do lado Next.js",
      "Postgres compartilhado com o Next.js — database própria no local, schema próprio (dominio) na mesma instância Supabase em produção",
    ],
  },
  {
    categoria: "Deploy & testes",
    itens: [
      "Dois projetos Vercel independentes (Next.js + Django) na mesma instância Supabase: auth-gateway no schema public, auth-gateway-django no schema dominio (isolados, sem FK entre eles)",
      "Deploy automático via GitHub a cada push na main, com prisma migrate deploy antes do build",
      "175 testes: 146 Next.js (Vitest contra servidor next dev real, não mocka cookies) + 6 E2E (Playwright, incluindo passkey via virtual authenticator) + 23 Django (pytest-django)",
      "CI no GitHub Actions (.github/workflows/ci.yml): lint, typecheck (com next typegen antes do tsc) e testes em todo PR/push na main, antes do deploy automático de produção",
      "Django não carrega .env na Vercel (load_dotenv só fora da plataforma) e .vercelignore mantém o arquivo fora do bundle — sem isso o serviço subia com DEBUG=True em produção",
    ],
  },
  {
    categoria: "Passkeys (WebAuthn)",
    itens: [
      "Login sem senha via @simplewebauthn — resistente a phishing, complementa a senha (que continua funcionando)",
      "Login por passkey pula o desafio de TOTP separado mesmo com MFA ativado: posse do authenticator + biometria/PIN local já equivale a um segundo fator",
      "Cadastrar/listar/remover passkeys em /dashboard; login sem digitar e-mail (credencial descobrível)",
      "Mesmas checagens do login por senha: suspensão, dispositivo novo, viagem impossível, limite de sessões simultâneas",
    ],
  },
];

export const proximosPassos: ItemProximoPasso[] = [
  {
    id: "django-debug-prod",
    titulo: "Django rodando com DEBUG=True em produção",
    descricao:
      "O `vercel deploy` empacotava o `django/.env` local (que tem DJANGO_DEBUG=\"True\" pra dev) e o `load_dotenv` de settings.py lia esse arquivo em produção — o Django vazava traceback completo, settings, SQL e nomes de env vars em toda página de erro, há ~45 dias. Fix: `load_dotenv` só fora da Vercel, `django/.vercelignore` novo, e DJANGO_DEBUG=False explícito no env.",
    categoria: "Segurança",
    prioridade: "alta",
    status: "feito",
    concluidoEm: "2026-08-29",
  },
  {
    id: "supabase-migracao",
    titulo: "Migrar os dois bancos pra Supabase",
    descricao:
      "Sair de dois projetos Neon separados para uma única instância Supabase: auth-gateway no schema `public`, auth-gateway-django no schema `dominio` (isolados, sem FK). Schema + dados de produção migrados e verificados. O deploy de produção estava travado há ~11 dias por env vars que faltavam (JWT_ALTERACAO_EMAIL_SECRET, JWT_PASSKEY_SECRET) — resolvido junto.",
    categoria: "Infraestrutura",
    prioridade: "alta",
    status: "feito",
    concluidoEm: "2026-08-29",
  },
  {
    id: "ci-typegen",
    titulo: "Consertar o CI (typecheck vermelho há 10 dias)",
    descricao:
      "O passo de typecheck rodava `tsc` sem gerar os tipos de rota do Next 16 (LayoutProps, RouteContext) antes — o CI falhava com \"Cannot find name\". `npm run typecheck` agora roda `next typegen && tsc`.",
    categoria: "Infraestrutura",
    prioridade: "alta",
    status: "feito",
    concluidoEm: "2026-08-29",
  },
  {
    id: "config-check-boot",
    titulo: "Checagem de config de produção no boot",
    descricao:
      "Vários recursos degradam em silêncio sem a env var (CAPTCHA, e-mail, Rollbar, links de e-mail). `src/instrumentation.ts` → `register()` aborta o boot em config quebrada (BASE_URL ausente, Turnstile pela metade) e loga aviso nas degradações toleráveis.",
    categoria: "Infraestrutura",
    prioridade: "media",
    status: "feito",
    concluidoEm: "2026-08-28",
  },
  {
    id: "senha-limite-bytes",
    titulo: "Limite de senha em bytes, não caracteres",
    descricao:
      "O `.max(72)` do Zod conta code units UTF-16; o bcryptjs trunca em 72 bytes. Uma senha curta com acentos/emoji passava e era truncada em silêncio. Trocado por um refine em bytes UTF-8.",
    categoria: "Segurança",
    prioridade: "baixa",
    status: "feito",
    concluidoEm: "2026-08-28",
  },
  {
    id: "separar-ratelimit-auditoria",
    titulo: "Separar o contador de rate limit da trilha de auditoria",
    descricao:
      "`src/lib/rateLimit.ts` conta linhas de `LogAuditoria` — a mesma tabela é trilha de auditoria (append-only, LGPD), contador de rate limit E detector de dispositivo novo. O job de limpeza não toca em `LogAuditoria`, então ela só cresce, e todo login/cadastro/reset roda um `count()` contra ela. Contador próprio com TTL + retenção/rollup da auditoria (a tabela `DesafioMfaConsumido` também nunca é limpa).",
    categoria: "Infraestrutura",
    prioridade: "media",
    status: "pendente",
  },
  {
    id: "rate-limit-endpoints-restantes",
    titulo: "Rate limit nos endpoints sensíveis que faltam",
    descricao:
      "POST /api/auth/atualizar (renovação — faz lookup + transação a cada chamada) e POST /api/auth/mfa/iniciar não têm limite. Login, cadastro, recuperação, troca de senha e exclusão já têm.",
    categoria: "Segurança",
    prioridade: "media",
    status: "pendente",
  },
  {
    id: "django-observabilidade",
    titulo: "Observabilidade no Django",
    descricao:
      "O Rollbar cobre só o app Next.js. Um erro 500 inesperado do serviço de domínio some nos logs da Vercel, sem alerta nem agregação.",
    categoria: "Infraestrutura",
    prioridade: "baixa",
    status: "pendente",
  },
  {
    id: "turnstile-producao",
    titulo: "Ativar o Turnstile em produção",
    descricao:
      "As duas chaves (TURNSTILE_SECRET_KEY + NEXT_PUBLIC_TURNSTILE_SITE_KEY) nunca foram configuradas na Vercel — o CAPTCHA de fricção progressiva está inativo em produção. O código já está pronto; falta criar o widget na Cloudflare e setar as env vars.",
    categoria: "Segurança",
    prioridade: "baixa",
    status: "pendente",
  },
  {
    id: "desconectar-neon",
    titulo: "Desconectar as integrações Neon",
    descricao:
      "`auth-gateway-db` e `auth-gateway-django-db` seguem conectadas como rollback pós-migração. Remover depois de confirmar o Supabase — enquanto conectadas, uma rotação de credencial da Neon re-injeta DATABASE_URL e sobrescreve a do Supabase.",
    categoria: "Infraestrutura",
    prioridade: "baixa",
    status: "pendente",
  },
  {
    id: "django-csrf-constant-time",
    titulo: "CSRF do Django em tempo constante",
    descricao:
      "`comum/autenticacao.py` compara o token com `==` (não constant-time); o lado Node usa `timingSafeEqual` de propósito. Diferença pequena, mas é uma inconsistência com o padrão que o projeto adotou.",
    categoria: "Segurança",
    prioridade: "baixa",
    status: "pendente",
  },
  {
    id: "ci-github",
    titulo: "CI no GitHub Actions",
    descricao:
      "Rodar lint, typecheck e a suíte de testes em todo PR antes de permitir merge — hoje nada impede um PR quebrado de ir pra main, que já tem deploy automático de produção.",
    categoria: "Infraestrutura",
    prioridade: "alta",
    status: "feito",
    concluidoEm: "2026-08-18",
  },
  {
    id: "auditoria-admin",
    titulo: "Auditoria de ações administrativas",
    descricao:
      "Registrar QUEM (qual admin) suspendeu, reativou ou excluiu uma conta, não só o alvo da ação — hoje o LogAuditoria não guarda o autor dessas mutações.",
    categoria: "Segurança",
    prioridade: "alta",
    status: "feito",
    concluidoEm: "2026-08-18",
  },
  {
    id: "lgpd-autoatendimento",
    titulo: "Autoatendimento LGPD (excluir/exportar a própria conta)",
    descricao:
      "Hoje só um admin exclui a conta de outra pessoa; o próprio usuário não consegue excluir nem exportar os próprios dados.",
    categoria: "Conformidade",
    prioridade: "alta",
    status: "feito",
    concluidoEm: "2026-08-18",
  },
  {
    id: "passkeys",
    titulo: "Passkeys / WebAuthn",
    descricao:
      "Complemento ou substituto do TOTP, resistente a phishing e sem fricção de app autenticador — next step natural depois do MFA que já existe.",
    categoria: "Segurança",
    prioridade: "alta",
    status: "feito",
    concluidoEm: "2026-08-18",
  },
  {
    id: "trocar-senha-logado",
    titulo: "Trocar senha estando logado",
    descricao:
      "Hoje só existe o fluxo \"esqueci a senha\" (via e-mail); falta um PUT /api/auth/senha autenticado pedindo a senha atual.",
    categoria: "Conta",
    prioridade: "media",
    status: "feito",
    concluidoEm: "2026-08-17",
  },
  {
    id: "alterar-email",
    titulo: "Alterar e-mail",
    descricao:
      "Exigiria confirmação em duas etapas (link no e-mail novo) pra não permitir sequestro silencioso da conta.",
    categoria: "Conta",
    prioridade: "media",
    status: "feito",
    concluidoEm: "2026-08-17",
  },
  {
    id: "painel-auditoria",
    titulo: "Painel de auditoria para admins",
    descricao:
      "LogAuditoria já tem os dados; falta uma tela em /dashboard pra consultar sem precisar acessar o banco direto.",
    categoria: "Admin",
    prioridade: "media",
    status: "feito",
    concluidoEm: "2026-08-17",
  },
  {
    id: "viagem-impossivel",
    titulo: "Detecção de \"viagem impossível\"",
    descricao:
      "Agora que sessões guardam cidade/UF/país, dá pra alertar quando duas sessões aparecem em locais incompatíveis num intervalo curto — reaproveitando o e-mail de dispositivo novo que já existe.",
    categoria: "Segurança",
    prioridade: "media",
    status: "feito",
    concluidoEm: "2026-08-17",
  },
  {
    id: "limite-sessoes",
    titulo: "Limite de sessões simultâneas",
    descricao:
      "Hoje um usuário pode ter sessões ativas ilimitadas ao mesmo tempo.",
    categoria: "Segurança",
    prioridade: "media",
    status: "feito",
    concluidoEm: "2026-08-17",
  },
  {
    id: "lembrar-dispositivo",
    titulo: "\"Lembrar este dispositivo\"",
    descricao:
      "Pular o desafio de MFA por N dias num dispositivo já verificado, reduzindo fricção sem abrir mão de segurança nos dispositivos novos.",
    categoria: "MFA",
    prioridade: "media",
    status: "feito",
    concluidoEm: "2026-08-17",
  },
  {
    id: "testes-e2e",
    titulo: "Testes E2E de navegador (Playwright)",
    descricao:
      "Cadastro/login, dashboard protegido e passkeys cobertos via UI renderizada de verdade (não só as rotas de API via Vitest), rodando no CI a cada PR/push na main.",
    categoria: "Testes",
    prioridade: "baixa",
    status: "feito",
    concluidoEm: "2026-08-19",
  },
  {
    id: "observabilidade",
    titulo: "Observabilidade em produção",
    descricao:
      "Rollbar (via Vercel Marketplace) captura erro inesperado de servidor (instrumentation.ts/onRequestError) e de cliente (error.tsx/global-error.tsx) — só no app Next.js por enquanto, o Django ainda não está coberto.",
    categoria: "Infraestrutura",
    prioridade: "baixa",
    status: "feito",
    concluidoEm: "2026-08-19",
  },
  {
    id: "senha-vazada",
    titulo: "Checagem de senha vazada",
    descricao:
      "Have I Been Pwned (k-anonymity) no cadastro/troca de senha, pra recusar senhas já conhecidas em vazamentos.",
    categoria: "Segurança",
    prioridade: "baixa",
    status: "feito",
    concluidoEm: "2026-08-14",
  },
  {
    id: "rate-limit-distribuido",
    titulo: "Rate limiting distribuído (Redis/Upstash)",
    descricao:
      "src/lib/rateLimit.ts já usa Postgres (LogAuditoria), compartilhado entre instâncias — não é em memória, não tem gap técnico hoje. Migrar pra Redis/Upstash só faria sentido se o tráfego crescesse a ponto dessa tabela virar gargalo, o que ainda não aconteceu. Decisão de escopo registrada (não uma tarefa esquecida), documentada no README.",
    categoria: "Infraestrutura",
    prioridade: "baixa",
    status: "descartado",
    concluidoEm: "2026-08-19",
  },
];
