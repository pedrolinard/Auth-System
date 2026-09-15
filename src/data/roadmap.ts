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

export const atualizadoEm = "2026-09-15";

// Métricas ESTÁTICAS do código — atualize junto com a mudança que as move
// (mesma disciplina do resto do arquivo). As métricas AO VIVO (contagens do
// banco, commit/deploy) são calculadas em tempo de requisição na página.
export const metricas = {
  rotasApi: 44,
  migracoesPrisma: 24,
  modulosLib: 39,
  tabelas: 13,
  testesVitest: 248,
  testesE2e: 8,
  testesDjango: 46,
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
      "Alterar e-mail com confirmação em duas etapas — exige a senha atual pra pedir a troca (access token roubado sozinho não basta), avisa o e-mail ANTIGO já no pedido; o endereço só muda depois de um link clicado no e-mail NOVO, o link é de uso único e confirmar a troca revoga todas as sessões e dispositivos confiáveis (mesma proteção da redefinição de senha)",
    ],
  },
  {
    categoria: "Tokens & sessões",
    itens: [
      "Access token RS256 de vida curta (15 min, com `iss`/`aud` checados no Next.js e no Django) + refresh token HS256 de longa duração (30 dias), ambos em cookies httpOnly",
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
      "Rate limiting por IP e por conta em login, cadastro e recuperação de senha (contador dedicado, tabela `limites_taxa`, janela fixa); renovação de token (só falhas, 20/15 min) e início de MFA (10/h) também limitados",
      "CAPTCHA (Cloudflare Turnstile) como fricção progressiva antes do bloqueio duro",
      "Limite de IP generoso (20 tentativas/15 min) pra não travar redes compartilhadas — CAPTCHA e limite por conta seguram a barra de verdade",
      "IP extraído de x-vercel-forwarded-for / x-real-ip (a Vercel controla, cliente não forja); o x-forwarded-for cru só como fallback de dev, porque na Vercel o item à esquerda é controlado pelo cliente",
    ],
  },
  {
    categoria: "Contas & RBAC",
    itens: [
      "RBAC mínimo de sistema (usuario/admin) como claim no token de acesso, mais RBAC por organização (dono/admin/membro) escopando as mesmas ações administrativas — ver categoria \"Multi-tenant (organizações)\" abaixo",
      "Dono/admin de organização pode suspender (temporária ou permanente) ou remover um membro — a suspensão vale só naquela organização (a pessoa segue entrando nas outras)",
      "Suspensão revoga na hora as sessões daquela organização e bloqueia a entrada nela; login só é recusado quando a pessoa está suspensa em todas as organizações",
      "Auditoria de ações administrativas registra também QUEM (qual admin) suspendeu/reativou/excluiu, não só o alvo",
      "Autoatendimento LGPD: POST /api/auth/minha-conta/exportar e DELETE /api/auth/minha-conta — o próprio titular exporta os dados que o serviço guarda sobre ele (dados pessoais, sessões, dispositivos confiáveis, códigos de backup, passkeys, auditoria, organizações de que é membro e convites que criou) ou exclui a conta; os dois exigem a senha atual + CSRF + rate limit (o export virou POST porque o arquivo traz IP/geolocalização/user-agents). Excluir a conta também apaga a organização pessoal órfã (Membro cascade-deleta, Organizacao sozinha não) e bloqueia quem é a única pessoa dona de uma organização com outros membros",
      "E-mails de segurança: dispositivo novo, MFA ativado/desativado, senha alterada, códigos de backup regenerados, reuso de refresh token detectado, viagem impossível (login em país diferente do último, tempo curto demais pra ser real)",
    ],
  },
  {
    categoria: "Auditoria & operação",
    itens: [
      "Logs de auditoria (login sucesso/falha, cadastro, logout, IP e user-agent)",
      "Painel de auditoria para admins (/dashboard/auditoria) — consulta os últimos 200 logs com filtro por evento/e-mail, atalhos de filtro e exportação em PDF (jsPDF carregado sob demanda), sem precisar acessar o banco direto",
      "Retenção da trilha de auditoria: o job de limpeza (POST /api/cron/limpar-tokens) poda LogAuditoria além de 365 dias e DesafioMfaConsumido já expirado, com índice em criadoEm pro DELETE não varrer a tabela",
      "Proteção CSRF explícita (double-submit cookie, comparado em tempo constante) em toda mutação autenticada por cookie",
      "Headers de segurança HTTP (HSTS, X-Frame-Options, X-Content-Type-Options, Permissions-Policy) e CSP com nonce por requisição nas páginas — sem 'unsafe-inline' em script-src — e política fechada nas rotas de API",
      "Job de limpeza de tokens expirados/revogados antigos, protegido por CRON_SECRET (comparado em tempo constante, mesma disciplina do token CSRF)",
      "Checagem de config de produção no boot (src/instrumentation.ts → register): aborta o boot se BASE_URL faltar ou o Turnstile estiver configurado pela metade; loga aviso pra degradações toleráveis (sem Resend, sem Rollbar, sem CRON_SECRET)",
      "Todas as colunas de data usam timestamptz — elimina ambiguidade de fuso horário entre o runtime da Vercel (UTC) e leituras de outros fusos",
    ],
  },
  {
    categoria: "Serviço de domínio (Django/DRF)",
    itens: [
      "Valida o mesmo token de acesso (RS256) do Next.js, com `algorithms` fixo e `iss`/`exp` obrigatórios, sem login próprio nem model de usuário",
      "Entidades reais (Projeto/Tarefa) isoladas por organização (organizacao_id, claim do JWT — não mais usuario_id sozinho), mesma proteção CSRF do lado Next.js (double-submit cookie comparado em tempo constante com hmac.compare_digest, igual ao timingSafeEqual do Node)",
      "Postgres compartilhado com o Next.js — database própria no local, schema próprio (dominio) na mesma instância Supabase em produção",
      "Observabilidade (Rollbar): recurso próprio via Vercel Marketplace, RollbarNotifierMiddleware captura erro 500 não tratado — mesmo provedor do Next.js, dashboard único pros dois serviços",
    ],
  },
  {
    categoria: "Multi-tenant (organizações)",
    itens: [
      "Modelo \"Slack-style\": uma conta pode ser membro de várias organizações, papel próprio por organização (Membro.papel: dono/admin/membro) — independente do papel de sistema (Usuario.papel) que já existia, mantido só pro painel de auditoria",
      "Organização ativa da sessão é um claim no próprio access token (organizacaoId/papelOrganizacao), não resolvida por parâmetro de rota — preserva o princípio de que o Django nunca consulta as tabelas do Next.js, só confia no JWT",
      "Trocar de organização (POST /api/auth/organizacoes/[id]/entrar) reemite tokens sem pedir senha de novo, mesmo padrão da conclusão de MFA; trade-off aceito: uma organização ativa por sessão de navegador",
      "RBAC de admin (listar/suspender/reativar/remover membro) escopado por organização — dono/admin da organização A não enxerga nem afeta contas da organização B",
      "Convites por e-mail com token JWT próprio (JWT_CONVITE_ORGANIZACAO_SECRET), reconvidar o mesmo e-mail atualiza o pendente em vez de duplicar, aceite exige a conta dona do e-mail convidado e é idempotente sob aceite concorrente",
      "Rate limit dedicado: criar organização (10/h por IP) e enviar convite (30/h por IP + 5/h por e-mail alvo)",
      "Cadastro cria a organização pessoal do usuário numa transação (Usuario + Organizacao + Membro dono) — sem organização órfã se algo falhar no meio",
      "Frontend: seletor de organização ativa no NavPainel, /dashboard/organizacoes (criar organização, convidar/revogar convite) e /aceitar-convite (autenticado e não-autenticado)",
      "Backfill idempotente (scripts/backfill-organizacoes.mjs + django/scripts/backfill_organizacoes.py) cria a organização pessoal de cada conta pré-existente e reatribui Projeto/Tarefa antigos — implementado em 5 fases, cada uma revisada; rodado em produção em 2026-09-08 (3 organizações criadas no lado Next.js, 0 falhas nos dois lados)",
    ],
  },
  {
    categoria: "Deploy & testes",
    itens: [
      "Dois projetos Vercel independentes (Next.js + Django) na mesma instância Supabase: auth-gateway no schema public, auth-gateway-django no schema dominio (isolados, sem FK entre eles)",
      "Deploy automático via GitHub a cada push na main, com prisma migrate deploy antes do build",
      "285 testes: 237 Next.js e SDK (Vitest contra servidor next dev real, não mocka cookies) + 8 E2E (Playwright, incluindo passkey via virtual authenticator, código de backup e várias abas) + 40 Django (pytest-django)",
      "CI no GitHub Actions (.github/workflows/ci.yml): lint, typecheck (com next typegen antes do tsc) e testes em todo PR/push na main, antes do deploy automático de produção",
      "Django não carrega .env na Vercel (load_dotenv só fora da plataforma) e .vercelignore mantém o arquivo fora do bundle — sem isso o serviço subia com DEBUG=True em produção",
    ],
  },
  {
    categoria: "Passkeys (WebAuthn)",
    itens: [
      "Login sem senha via @simplewebauthn — resistente a phishing, complementa a senha (que continua funcionando)",
      "Login por passkey pula o desafio de TOTP separado mesmo com MFA ativado: posse do authenticator + biometria/PIN local já equivale a um segundo fator — `userVerification: required` no registro e no login (e `requireUserVerification` no verify) garante que a verificação local sempre aconteça, senão a passkey viraria fator único",
      "Cadastrar/listar/remover passkeys em /dashboard/seguranca; login sem digitar e-mail (credencial descobrível)",
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
      "`src/lib/rateLimit.ts` contava linhas de `LogAuditoria` — a mesma tabela era trilha de auditoria (append-only, LGPD), contador de rate limit E detector de dispositivo novo. Feito em duas levas: (2026-08-31) job de limpeza podando `LogAuditoria` além de 365 dias, com índice `criadoEm` novo. (2026-09-01) tabela dedicada `limites_taxa` — uma linha por chave (ip/e-mail + evento), incrementada com `INSERT ... ON CONFLICT DO UPDATE` em janela fixa (mesmo padrão do INCR+EXPIRE do Redis, sem precisar de Redis). `contarEventosPorIp`/`limiteExcedido`/`limiteExcedidoPorEmail` agora leem essa tabela (O(1) por chamada) em vez de fazer `count()` em `LogAuditoria`; o job de limpeza poda linhas expiradas. `LogAuditoria` continua intacta para auditoria e detecção de dispositivo novo — só parou de ser o contador.",
    categoria: "Infraestrutura",
    prioridade: "media",
    status: "feito",
    concluidoEm: "2026-09-01",
  },
  {
    id: "varredura-seguranca-2026-08",
    titulo: "Varredura de segurança — itens de média/baixa",
    descricao:
      "Export LGPD (`POST /api/auth/minha-conta/exportar`) passou a exigir a senha atual + CSRF + rate limit (era GET só com cookie, mas o arquivo traz IP/geo/UA + 500 eventos). `esqueci-senha` ganhou limite por e-mail (3/h) sem quebrar a resposta anti-enumeração. Access token agora carrega `iss`/`aud`, validados no Next.js e no Django (`options={require:[exp,iss,aud]}`). CSP com `object-src 'none'` + `upgrade-insecure-requests`. Retenção da auditoria (ver item acima). Export de auditoria em PDF pra admins (jsPDF, carregado sob demanda).",
    categoria: "Segurança",
    prioridade: "media",
    status: "feito",
    concluidoEm: "2026-08-31",
  },
  {
    id: "csp-nonce",
    titulo: "CSP sem 'unsafe-inline' (nonce por requisição)",
    descricao:
      "`script-src` tinha `'unsafe-inline'`, então um XSS que conseguisse injetar um <script> rodava — num serviço de autenticação, isso vale o token de quem está logado. Agora o CSP das páginas é montado no src/proxy.ts com um nonce novo a cada requisição e `'strict-dynamic'` (src/lib/csp.ts): o Next carimba o nonce nos próprios scripts e os chunks carregados por eles herdam a confiança, sem nonce um a um. As rotas de API recebem uma política fixa fechada (`default-src 'none'`) via next.config.ts. Custo aceito: toda página passa a ser renderizada por requisição (`await connection()` no layout raiz) — página pré-gerada no build sairia sem nonce e com os scripts do Next bloqueados, e isso só aparece em produção (em dev tudo já é dinâmico). Conferido num build de produção de verdade: todo <script> do HTML sai com o nonce do header, nenhuma violação no Chromium, hidratação funcionando e o widget do Turnstile (chaves de teste da Cloudflare) carregando e emitindo token sob o CSP novo. `style-src` segue com 'unsafe-inline': atributo style=\"\" não aceita nonce e CSS não executa código.",
    categoria: "Segurança",
    prioridade: "baixa",
    status: "feito",
    concluidoEm: "2026-09-14",
  },
  {
    id: "cadastro-enumeracao",
    titulo: "Cadastro sem enumeração de e-mail",
    descricao:
      "`POST /api/auth/cadastro` respondia 409 \"e-mail já cadastrado\" — qualquer um descobria quais endereços têm conta. Agora e-mail novo e e-mail já cadastrado recebem a mesma resposta (201, mesmo corpo, sem o usuário criado — os campos dele só existiriam num dos casos) e fazem o mesmo trabalho antes de responder (hash da senha, tentativa de insert, um envio de e-mail), pra o tempo também não separar os dois. Quem já tinha conta recebe um e-mail \"tentaram criar uma conta com o seu e-mail\" com os links de login e de recuperação de senha — é por ali, na caixa de entrada que só o dono lê, que a pessoa que esqueceu que tinha conta acha o caminho, em vez de pela tela. Esse aviso tem teto de 3/h por endereço, pra o cadastro não virar ferramenta de encher a caixa de alguém. A conta existente não é tocada (nem nome, nem senha). A tela diz o mesmo nos dois casos: \"Cadastro recebido. Confira seu e-mail e entre com sua senha.\"",
    categoria: "Segurança",
    prioridade: "baixa",
    status: "feito",
    concluidoEm: "2026-09-14",
  },
  {
    id: "rate-limit-endpoints-restantes",
    titulo: "Rate limit nos endpoints sensíveis que faltam",
    descricao:
      "POST /api/auth/atualizar (renovação — faz lookup + transação a cada chamada) e POST /api/auth/mfa/iniciar não tinham limite. atualizar agora conta só as FALHAS por IP (20/15 min — uma renovação legítima não escreve nada); mfa/iniciar limita as tentativas por IP (10/h), igual ao reenviar-verificacao.",
    categoria: "Segurança",
    prioridade: "media",
    status: "feito",
    concluidoEm: "2026-08-29",
  },
  {
    id: "django-observabilidade",
    titulo: "Observabilidade no Django",
    descricao:
      "O Rollbar cobria só o app Next.js — um erro 500 inesperado do serviço de domínio sumia nos logs da Vercel, sem alerta nem agregação. Resolvido: recurso Rollbar próprio provisionado via Vercel Marketplace no projeto auth-gateway-django (mesmo provedor do Next.js, um dashboard só para os dois), `rollbar.contrib.django.middleware.RollbarNotifierMiddleware` como último item de MIDDLEWARE (precisa ser o último — escuta o sinal got_request_exception, que só dispara depois que os middlewares anteriores e a view já tiveram a chance de tratar a exceção). Exceções que o DRF já converte em Response (APIException, Http404, PermissionDenied) nunca chegam a esse sinal — só bug de verdade (exceção não tratada) é reportado. Middleware só entra na lista quando o token está presente (degrada em silêncio sem ele, mesmo princípio do turnstile.ts/email.ts do lado Next.js).",
    categoria: "Infraestrutura",
    prioridade: "baixa",
    status: "feito",
    concluidoEm: "2026-09-01",
  },
  {
    id: "turnstile-producao",
    titulo: "Ativar o Turnstile em produção",
    descricao:
      "As duas chaves (TURNSTILE_SECRET_KEY + NEXT_PUBLIC_TURNSTILE_SITE_KEY) foram criadas na Cloudflare e configuradas na Vercel (produção), com redeploy pra embutir a chave pública no build. Confirmado em prod: após 5 falhas de login por IP, a 6ª já responde `captchaNecessario: true` em vez de deixar passar (fail-closed).",
    categoria: "Segurança",
    prioridade: "baixa",
    status: "feito",
    concluidoEm: "2026-09-01",
  },
  {
    id: "desconectar-neon",
    titulo: "Desconectar as integrações Neon",
    descricao:
      "`auth-gateway-db` e `auth-gateway-django-db` ficaram conectadas como rollback pós-migração pro Supabase — enquanto conectadas, uma rotação de credencial da Neon re-injetava DATABASE_URL e sobrescrevia a do Supabase. Desconectadas (não excluídas — os bancos Neon continuam existindo, só pararam de ficar linkados aos projetos Vercel) via `vercel integration-resource disconnect`, confirmado sem quebrar nada (cadastro → login → rota do Django, ponta a ponta em produção).",
    categoria: "Infraestrutura",
    prioridade: "baixa",
    status: "feito",
    concluidoEm: "2026-09-01",
  },
  {
    id: "multi-tenant-organizacoes",
    titulo: "Multi-tenant (organizações)",
    descricao:
      "Sistema passa de single-tenant (papel global, dados isolados só por usuario_id) pra multi-tenant: uma conta pode ser membro de várias organizações, com papel próprio por organização (dono/admin/membro). Organização ativa vira claim no access token (organizacaoId/papelOrganizacao); trocar de organização reemite tokens sem reautenticar. Django isolado por organizacao_id. RBAC de admin (listar/suspender/reativar/remover membro) escopado por organização. Convites por e-mail com token JWT próprio, aceite idempotente sob corrida. Rate limit dedicado pra criar organização e enviar convite. Frontend: seletor de organização, /dashboard/organizacoes, /aceitar-convite. Implementado em 5 fases (schema/backfill → sessão/token → Django → RBAC → convites/UI), cada uma revisada e corrigida antes da seguinte. Backfill rodado em produção em 2026-09-08 (3 organizações criadas no lado Next.js; migrate + backfill do Django sem falhas) — feature no ar nos dois serviços. Achado no processo de deploy: os endpoints de autoatendimento LGPD (export/exclusão da própria conta) tinham ficado pra trás — export não incluía organizações/convites, exclusão deixava a organização pessoal órfã e não bloqueava a única pessoa dona de uma organização com outros membros; corrigidos no mesmo dia.",
    categoria: "Multi-tenant",
    prioridade: "alta",
    status: "feito",
    concluidoEm: "2026-09-01",
  },
  {
    id: "deploy-travado-env-var",
    titulo: "Deploy de produção quebrado 7 dias por env var faltando",
    descricao:
      "O multi-tenant foi pra main em 01/09 e ficou 7 dias fora do ar sem ninguém notar: os dois últimos deploys de produção estavam em ERROR. Causa: `src/lib/token.ts` faz `throw` na avaliação do módulo se faltar qualquer segredo, e a `JWT_CONVITE_ORGANIZACAO_SECRET` (nova) nunca foi criada no ambiente de produção — o `next build` morre em \"Collecting page data\". O CI do GitHub Actions passava verde porque lá a variável existe, então nada sinalizou. Segunda vez que esse modo de falha acontece (a primeira foi JWT_ALTERACAO_EMAIL_SECRET/JWT_PASSKEY_SECRET, ~11 dias). Agravante: `npm run build` roda `prisma migrate deploy` ANTES do `next build`, então os builds que falharam já tinham aplicado as migrations — produção ficou com schema novo e código velho, estado que só não quebrou nada porque o código antigo ignora as tabelas novas. Destravado na ordem schema → dados → código: backfill primeiro (com o código velho ainda no ar, o que eliminou a janela em que conta pré-existente ficaria sem conseguir logar), depois a env var, depois o redeploy — mesma sequência repetida no Django.",
    categoria: "Infraestrutura",
    prioridade: "alta",
    status: "feito",
    concluidoEm: "2026-09-08",
  },
  {
    id: "migrations-fora-do-build",
    titulo: "Migration deixa de ser efeito colateral do build",
    descricao:
      "O script `build` rodava `prisma migrate deploy`, e como os ambientes Preview e Production da Vercel compartilham a mesma instância Supabase, o build de preview de um pull request aplicou as migrations da Fase 00 no banco de PRODUÇÃO. O preview falhou logo depois (DJANGO_SERVICE_URL só existe em Production, então o rewrite de /api/dominio ficou inválido), mas `migrate deploy` roda ANTES do `next build` — o estrago já estava feito. Produção ficou com schema novo e código velho: `POST /api/auth/cadastro` passou a responder 500 (P2011, violação de NOT NULL em aplicacaoId) até o merge do PR sair. Fix: `scripts/checar-migrations.mjs` no lugar do `migrate deploy` no build — ele verifica e nunca aplica. Em Production, migration pendente (ou DATABASE_URL ausente, ou banco inacessível) INTERROMPE o build com instruções; em Preview e local, avisa e segue. Falha fechado onde importa: a primeira versão do próprio script falhava aberto (pulava a checagem quando não achava DATABASE_URL, porque um `npm run build` local não carrega .env sozinho), que é exatamente o padrão que produziu o incidente — corrigido carregando .env.local/.env como o Next faz e tratando ausência de banco como erro em produção. Aplicar migration virou passo deliberado (`npx prisma migrate deploy` com o DATABASE_URL do ambiente), igual ao lado Django, que sempre foi assim. Fica em aberto o passo seguinte: dar um banco próprio ao ambiente Preview, pra que preview volte a ser um ambiente de verdade em vez de um leitor do banco de produção.",
    categoria: "Infraestrutura",
    prioridade: "alta",
    status: "feito",
    concluidoEm: "2026-09-08",
  },
  {
    id: "preview-com-banco-proprio",
    titulo: "Banco próprio para o ambiente Preview",
    descricao:
      "Preview e Production compartilham a mesma instância Supabase e o mesmo DATABASE_URL. Depois do portão de migrations, um preview não escreve mais no banco de produção — mas ainda LÊ dele, e roda contra um schema que pode não ser o do próprio branch. Um banco próprio (ou um branch de banco por PR) devolveria ao preview a função de ambiente de verdade. Não foi feito junto porque envolve provisionar e semear um segundo banco, e o sangramento já parou com o portão. Andamento em 2026-09-14/15: projeto Supabase próprio do Preview criado (mfpjqueyefqqzewksqgt) e migrado; o rewrite do Django deixou de quebrar o build sem DJANGO_SERVICE_URL. Falta: semear o banco novo (aplicação padrão e chave de assinatura próprias), apontar o DATABASE_URL do Preview pra ele e criar as env vars que faltam no Preview — passo a passo em docs/operacao.md, item 6.",
    categoria: "Infraestrutura",
    prioridade: "media",
    status: "pendente",
  },
  {
    id: "identidade-por-aplicacao",
    titulo: "Fase 00 do provedor: identidade por aplicação + JWKS",
    descricao:
      "Primeira fase de transformar o sistema num provedor de auth vendável. Modelos Aplicacao (o cliente que integra: clientId, segredo hasheado, origens permitidas, RP ID de passkey) e ChaveAssinatura (conjunto RS256 com kid, chave privada cifrada em repouso). Usuario e Organizacao ganham aplicacaoId; o índice único de e-mail deixa de ser global e vira (aplicacaoId, email), e o slug de organização também passa a ser único por aplicação — dois clientes podem ter o mesmo usuário final e o mesmo nome de organização sem colidir. Access token passa a carregar kid no header e aplicacaoId (também como aud), e a verificação resolve a chave pelo kid via /.well-known/jwks.json; o Django troca a chave estática por um cliente JWKS com cache, então rotacionar chave deixa de exigir deploy coordenado (scripts/rotacionar-chave-assinatura.mjs faz gerar → ativar → remover na ordem segura). Duas travas de isolamento que só apareceram lendo o código: a chave do rate limit por e-mail não levava aplicação (um cliente trancava o usuário do outro só martelando o mesmo endereço) e o RP ID das passkeys era env var global (credencial WebAuthn é presa à origem em que nasceu, então precisa ser por aplicação). Requisição sem header cai numa aplicação padrão, o que manteve todo o front atual funcionando sem reescrita. A migration destrutiva faz o próprio backfill em SQL, de forma idempotente, porque o build da Vercel aplica todas as migrations pendentes de uma vez — depender de um script externo ter rodado no meio quebraria o deploy. +15 testes: isolamento entre aplicações, rate limit cruzado, JWKS e o ciclo completo de rotação de chave.",
    categoria: "Multi-tenant",
    prioridade: "alta",
    status: "feito",
    concluidoEm: "2026-09-08",
  },
  {
    id: "suspensao-por-organizacao",
    titulo: "Suspensão de conta por organização, não por conta inteira",
    descricao:
      "suspenso/suspensoAte/suspensoMotivo eram campos globais do Usuario — um dono/admin da organização A que suspendesse alguém bloqueava essa pessoa em TODAS as organizações, inclusive a pessoal. A suspensão foi pra dentro de Membro: login abre na primeira organização em que a pessoa não está suspensa e só é recusado se ela estiver suspensa em todas; trocar pra organização suspensa responde 403 com prazo e motivo; renovar sessão de organização suspensa é recusado; suspender revoga só as sessões daquela organização. A listagem de organizações marca as suspensas (sem motivo), e o export LGPD inclui a suspensão — prazo e motivo foram escritos sobre a pessoa. Migration só aditiva: copia as suspensões de conta ainda ativas pra cada Membro (preserva o efeito de hoje, cada organização passa a poder reativar só a sua parte) e deixa as colunas antigas no lugar, sem uso, porque o código anterior ainda as lê na janela entre migration e deploy. Achado no caminho, e corrigido junto: a detecção de reuso de refresh token tratava como roubo qualquer token revogado reapresentado — então a pessoa suspensa ou removida de UMA organização, ao renovar a sessão dela, perdia as sessões de todas as outras e recebia um e-mail de \"atividade suspeita\". O caso de remoção já existia desde o multi-tenant. A correção definitiva veio no pente fino de 2026-09-15: toda revogação passou a gravar o motivo, e só a revogação por rotação conta como roubo (ver item \"pente-fino-2026-09-15\").",
    categoria: "Multi-tenant",
    prioridade: "baixa",
    status: "feito",
    concluidoEm: "2026-09-14",
  },
  {
    id: "gestao-aplicacoes",
    titulo: "Fase 01 do provedor: gestão de aplicações",
    descricao:
      "Até aqui, criar uma aplicação cliente era INSERT à mão no banco. Agora /dashboard/aplicacoes e /api/auth/aplicacoes cadastram, editam (nome, origens, RP ID de passkey), desativam/reativam e rotacionam o clientSecret. Só quem opera o provedor acessa: admin de sistema com conta NA APLICAÇÃO PADRÃO — um admin de sistema dentro de uma aplicação cliente não enxerga as outras (mesmo raciocínio do escopo da auditoria por aplicação, um nível acima). O segredo aparece uma única vez e só o hash SHA-256 é gravado; rotacionar invalida o anterior na hora. Validação que evita configuração que nunca funciona: origem precisa ser só esquema+host (é comparada byte a byte com o header Origin e com a origem do WebAuthn), http só em localhost, e o RP ID tem que cobrir todas as origens (regra do WebAuthn). Trocar o RP ID de uma aplicação com passkeys registradas é recusado (409) — invalidaria todas em silêncio. Não existe exclusão (Restrict nas contas é proposital); desativar derruba na hora as sessões dos usuários finais daquela aplicação, e a renovação delas é recusada sem disparar o alerta de reuso de token. A aplicação padrão não pode ser desativada: o próprio painel depende dela.",
    categoria: "Multi-tenant",
    prioridade: "alta",
    status: "feito",
    concluidoEm: "2026-09-14",
  },
  {
    id: "validar-client-secret",
    titulo: "Autenticação da aplicação cliente, CORS e SDK",
    descricao:
      "O clientId é público e só selecionava o tenant — qualquer site ou script podia falar em nome de uma aplicação cliente. Agora as rotas públicas (cadastro, login, esqueci-senha, login por passkey) passam por autenticarAplicacao: chamada de navegador precisa vir de uma origem cadastrada (lista vazia recusa — antes aceitava qualquer origem) e chamada de servidor precisa do client secret no header x-aplicacao-segredo (comparado por hash em tempo constante). A aplicação padrão segue como antes. CORS: o proxy responde ao preflight só pra origens de aplicações ativas, sem liberar o header do segredo nem cookies entre domínios; o JWKS é público (Access-Control-Allow-Origin: *). Logout passou a aceitar o refresh token no corpo — sem isso, uma aplicação integrada não tinha como revogar a sessão. SDK em sdk/: ClienteAuthGateway (cadastro, login com MFA e código de backup, renovação deduplicada, logout, usuário atual, conclusão dos links de e-mail) e criarVerificadorDeToken (valida o JWT no backend do cliente pelo JWKS, com audiência). O painel mostra a Audience (aud) de cada aplicação. Guia em docs/integracao.md; testes do SDK contra o servidor real em tests/sdk.",
    categoria: "Multi-tenant",
    prioridade: "alta",
    status: "feito",
    concluidoEm: "2026-09-15",
  },
  {
    id: "marca-emails",
    titulo: "E-mails com a marca de cada aplicação",
    descricao:
      "Um usuário final do cliente \"Acme\" recebia e-mail de \"Auth Gateway\" pedindo pra confirmar o e-mail — cara de phishing. Agora todo e-mail sai com o nome da aplicação dona da conta no assunto e no cabeçalho, e cada aplicação pode configurar remetente próprio (domínio verificado no Resend), logo e o endereço base dos links (verificar e-mail, redefinir senha, confirmar troca de e-mail, aceitar convite) — pra hospedar essas páginas no próprio site com o SDK. A marca vem sempre da aplicação DONA DA CONTA, nunca do header da requisição. Os 17 envios, que repetiam o mesmo bloco, passaram por um envio central best-effort; o nome no header From é saneado e todo campo da marca é escapado no HTML. De quebra: o assunto do convite mostrava \"&amp;\" quando o nome da organização tinha \"&\" (o assunto não é HTML).",
    categoria: "Multi-tenant",
    prioridade: "media",
    status: "feito",
    concluidoEm: "2026-09-15",
  },
  {
    id: "pente-fino-2026-09-15",
    titulo: "Pente fino no projeto inteiro",
    descricao:
      "Leitura de todos os módulos de src/lib, todas as rotas de API, telas críticas, serviço Django, scripts, CI e configuração. Corrigido, cada um com teste de regressão: (1) aceitar convite deixava uma conta de OUTRA aplicação entrar na organização (o e-mail só é único por aplicação); (2) cache de chaves públicas sem expiração — chave removida do JWKS seguia aceita em instâncias aquecidas; (3) CSRF era dispensado quando só o cookie CSRF faltava, mesmo com cookie de sessão (Next e Django); (4) reconfirmar o MFA gerava mais 10 códigos de backup sem invalidar os antigos; (5) MFA e código de backup concluíam login em aplicação desativada durante o desafio; (6) alarme de reuso de refresh token disparava em qualquer revogação — troca de senha em outro aparelho, logout, limite de sessões, suspensão — derrubando a sessão NOVA da pessoa e mandando e-mail de invasão falso: toda revogação agora grava o motivo e só a rotação conta como roubo; (7) renovação concorrente do mesmo token abria duas sessões e podia sobrescrever uma suspensão — rotação só com o token ainda ativo, e o navegador serializa renovações entre abas (Web Locks) pra não virar logout falso; (8) a tela de login não tinha como usar código de backup (a API existia, os códigos não serviam pra entrar); (9) /roadmap público expunha contagem de contas, admins e sessões de produção; (10) conta sem organização dava 500 sem corpo no login — agora ganha a organização pessoal; o script backfill-organizacoes estava quebrado desde a Fase 00; (11) erro 500 aparecia na tela como \"Unexpected end of JSON input\"; (12) aceitar convite estando suspenso, verificar e-mail de conta excluída e passkey duplicada davam 500; (13) Django dava 500 com ?projeto=abc; (14) datas gravadas deslocadas em Postgres fora de UTC (sessão agora sempre em UTC); (15) rewrite do Django inválido sem DJANGO_SERVICE_URL quebrava todo build de Preview; (16) exclusão de conta sumia da auditoria do cliente; \"sair de todos os dispositivos\" não era auditado; (17) sem aviso de EMAIL_FROM no sandbox do Resend em produção. Limpeza: .gitignore duplicado (a última linha re-ignorava o .env.example), comentários desatualizados, testes que dependiam de contadores de rate limit persistidos (e-mail e IP fixos) e deixavam 3.093 organizações órfãs no banco de teste.",
    categoria: "Segurança",
    prioridade: "alta",
    status: "feito",
    concluidoEm: "2026-09-15",
  },
  {
    id: "revisao-seguranca-infra-2026-09-15",
    titulo: "Revisão de segurança, front end e infraestrutura",
    descricao:
      "Segunda rodada, sobre problemas reais levantados depois do pente fino. (1) Resposta perdida virava \"roubo\": o servidor rotacionava o refresh token, a resposta não chegava (rede móvel, aba fechada) e a retentativa com o token antigo derrubava todas as sessões e mandava e-mail de invasão — agora reapresentar um token rotacionado há menos de 30 s só é recusado. (2) O SDK com armazenamento persistente deslogava as abas: a que perdia a corrida da renovação apagava o par novo da outra — Web Locks entre instâncias, releitura do armazenamento e só limpa se o token guardado ainda for o enviado. (3) Client secret errado passava quando vinha junto uma Origin cadastrada — o segredo agora decide sempre que vier, e a documentação deixou de vender a origem como barreira contra script. (4) Na integração pelo servidor todo usuário chegava com o IP do backend do cliente e dividia limite e captcha — x-usuario-ip aceito só com o secret conferido. (5) MFA só tinha limite por IP: força bruta distribuída dos códigos de 6 dígitos — limite por conta (10 falhas em 15 min). (6) Captcha sem saída pra aplicação em outro domínio — a resposta traz a sitekey e o guia explica liberar o domínio na Cloudflare. (7) A limpeza de tokens nunca rodava em produção (nada agendava a rota) — vercel.json com Vercel Cron diário. (8) Nenhum monitor de disponibilidade — workflow do GitHub Actions a cada 15 min nos dois endpoints de saúde. (9) API do Django sem limite de requisições — 300/min por usuário, mensagem em português. (10) Conexão com o banco sem verificar certificado — suporte a DATABASE_CA_CERT nos dois serviços (ligar segue o teste de docs/operacao.md). (11) Navegação no painel sem retorno visual desde que toda página renderiza por requisição — esqueleto de carregamento.",
    categoria: "Segurança",
    prioridade: "alta",
    status: "feito",
    concluidoEm: "2026-09-15",
  },
  {
    id: "banco-tls-e-usuario-django",
    titulo: "Ligar TLS verificado no banco e separar o usuário do Django",
    descricao:
      "O código já aceita DATABASE_CA_CERT, mas produção segue com sslmode=no-verify até alguém testar o certificado do Supabase contra o host do pooler e ligar a variável (Preview primeiro; um CA que não bata derruba toda conexão). E o Django provavelmente usa o mesmo usuário do banco que o Next.js, então quem o comprometer lê hashes de senha e segredos de MFA. SQL e ordem segura em docs/operacao.md, itens 7 e 8.",
    categoria: "Infraestrutura",
    prioridade: "alta",
    status: "pendente",
  },
  {
    id: "django-migration-pendente-producao",
    titulo: "Tela de projetos em 500 por migration do Django não aplicada",
    descricao:
      "Descoberto em 2026-09-15: GET /api/dominio/projetos respondia 500 em produção pra qualquer usuário logado — \"column tarefas_projeto.organizacao_id does not exist\". O código do multi-tenant estava no ar desde 08/09, mas a migration tarefas.0002 nunca chegou ao banco de produção (o registro dizia que o migrate tinha rodado; o banco dizia que não). O lado Next.js tem portão de migrations no build desde o incidente de 08/09; o Django, de deploy manual, não tinha nenhum. Correção no código: django/scripts/checar_migrations.py (rodar antes de todo `vercel deploy --prod`, sai com erro e lista o que falta) e GET /api/dominio/saude (503 com migrationsPendentes, pro monitor externo). Correção no banco: SQL idempotente entregue pra rodar no SQL Editor do Supabase (aplica a 0002, faz o backfill de organizacao_id e registra a migration em django_migrations) — escrita em produção a partir desta sessão foi bloqueada pela política de permissões.",
    categoria: "Infraestrutura",
    prioridade: "alta",
    status: "feito",
    concluidoEm: "2026-09-15",
  },
  {
    id: "saude",
    titulo: "Endpoint de saúde para monitoramento",
    descricao:
      "GET /api/saude verifica o banco e a chave de assinatura (sem as duas nenhum login funciona) e responde 503 se qualquer uma falhar, sem detalhe interno. É o alvo do monitor externo de disponibilidade descrito em docs/operacao.md.",
    categoria: "Infraestrutura",
    prioridade: "media",
    status: "feito",
    concluidoEm: "2026-09-15",
  },
  {
    id: "infra-para-vender",
    titulo: "Infraestrutura de produção para cliente pagante",
    descricao:
      "Domínio próprio (muda BASE_URL, RP ID das passkeys e o que os clientes configuram — trocar depois quebra as passkeys), domínio de e-mail verificado no Resend, planos pagos (Vercel, Supabase com backup e PITR), restauração de backup testada, alerta do Rollbar e monitor externo em /api/saude com página de status. Não é código: passo a passo em docs/operacao.md.",
    categoria: "Infraestrutura",
    prioridade: "alta",
    status: "pendente",
  },
  {
    id: "pentest-e-juridico",
    titulo: "Pentest externo e revisão jurídica",
    descricao:
      "Antes do primeiro cliente relevante: teste de intrusão externo (escopo sugerido em docs/seguranca/escopo-pentest.md, contra o ambiente de Preview isolado) e revisão por advogado dos rascunhos em docs/juridico (termos de uso, política de privacidade, acordo de tratamento de dados — o provedor é operador dos dados dos usuários dos clientes). Também confirmar quem detém os direitos do código e as regiões de hospedagem (transferência internacional, art. 33 da LGPD).",
    categoria: "Segurança",
    prioridade: "alta",
    status: "pendente",
  },
  {
    id: "exclusao-dados-dominio",
    titulo: "Excluir os projetos e tarefas no Django junto com a organização",
    descricao:
      "Excluir a própria conta apagava a organização pessoal no Next.js, mas os projetos e tarefas dela no serviço Django (schema dominio, sem FK entre os serviços) ficavam órfãos — direito ao esquecimento incompleto. Agora o pedido de exclusão entra numa fila (exclusoes_dominio_pendentes) na MESMA transação que apaga a organização, e o gateway chama POST /api/dominio/interno/excluir-organizacoes logo depois da resposta, com um token de serviço RS256 de 2 min (mesma chave do JWKS, audiência própria, organizações dentro do token e não no corpo). O que falhar com o Django fora do ar o job diário de limpeza reenvia. O token de serviço é recusado como token de usuário nos dois serviços.",
    categoria: "Multi-tenant",
    prioridade: "media",
    status: "feito",
    concluidoEm: "2026-09-16",
  },
  {
    id: "publicar-sdk",
    titulo: "Publicar o SDK no npm",
    descricao:
      "O SDK (sdk/) é consumido direto da fonte. Para um cliente instalar, falta um passo de build (.js + .d.ts), o nome público do pacote e versionamento semântico ligado às mudanças de contrato da API.",
    categoria: "Multi-tenant",
    prioridade: "baixa",
    status: "pendente",
  },
  {
    id: "remover-colunas-suspensao-legado",
    titulo: "Remover as colunas de suspensão legadas de Usuario",
    descricao:
      "Usuario.suspenso/suspensoAte/suspensoMotivo ficaram no schema sem uso depois da suspensão por organização, de propósito: derrubá-las junto com a troca de código quebraria o login na janela entre a migration e o deploy (o código anterior ainda as seleciona). Sai numa migration própria, num deploy POSTERIOR ao da suspensão por organização.",
    categoria: "Multi-tenant",
    prioridade: "baixa",
    status: "pendente",
  },
  {
    id: "auditoria-alvo-aplicacao",
    titulo: "Auditoria da gestão de aplicações sem o alvo",
    descricao:
      "Os eventos aplicacao_criada/atualizada/desativada/reativada e segredo_aplicacao_rotacionado registram QUEM agiu (autorId/autorEmail) e caem na trilha da aplicação padrão, mas LogAuditoria não tem coluna pra dizer QUAL aplicação foi alterada — usuarioId/email descrevem uma conta, não um cliente. Precisa de um campo de alvo (ou metadados) na tabela.",
    categoria: "Auditoria",
    prioridade: "baixa",
    status: "pendente",
  },
  {
    id: "django-csrf-constant-time",
    titulo: "CSRF do Django em tempo constante",
    descricao:
      "`comum/autenticacao.py` comparava o token com `==` (não constant-time); o lado Node usa `timingSafeEqual` de propósito. Trocado por `hmac.compare_digest`, com `try/except TypeError` pra header não-ASCII virar 403, não 500. +6 testes cobrindo o ProtegidoContraCsrf (que não tinha nenhum).",
    categoria: "Segurança",
    prioridade: "baixa",
    status: "feito",
    concluidoEm: "2026-08-29",
  },
  {
    id: "cron-secret-constant-time",
    titulo: "CRON_SECRET comparado em tempo constante",
    descricao:
      "`/api/cron/limpar-tokens` comparava o Bearer com `!==` — a mesma folga de timing que o token CSRF já evitava com `timingSafeEqual`. O `timingSafeEqual` de `csrf.ts` virou `compararEmTempoConstante` em `cripto.ts`, reusado nas duas rotas. +9 testes (o helper e a rota do cron, que não tinha nenhum).",
    categoria: "Segurança",
    prioridade: "baixa",
    status: "feito",
    concluidoEm: "2026-08-29",
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
