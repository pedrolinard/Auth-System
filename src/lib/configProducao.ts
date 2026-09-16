import "server-only";

// Checagem de sanidade da configuração de produção, rodada uma vez no boot
// do servidor (src/instrumentation.ts).
//
// Vários recursos degradam EM SILÊNCIO quando falta a env var correspondente
// — ótimo pra dev (não trava quem não tem conta na Cloudflare/Resend/Rollbar),
// perigoso num deploy de produção que esqueceu de configurar algo:
//
//   - sem TURNSTILE_SECRET_KEY:      o CAPTCHA é pulado (verificarTurnstile
//                                    retorna true)
//   - sem RESEND_API_KEY:            nenhum e-mail sai (erro, exceto em Preview)
//   - sem ROLLBAR_*:                 erros inesperados não são reportados
//   - sem BASE_URL:                  links de e-mail apontam pra localhost:3000
//
// Os segredos JWT e a MFA_ENCRYPTION_KEY já falham o boot por conta própria
// (throw em src/lib/token.ts), então não são checados de novo aqui.

export type ResultadoConfig = {
  // Config que torna a aplicação ativamente quebrada ou insegura em produção
  // — melhor abortar o boot do que servir assim.
  erros: string[];
  // Degradação tolerável — a aplicação funciona, mas com menos rede de
  // proteção. Loga e segue.
  avisos: string[];
};

type Env = Record<string, string | undefined>;

function definida(env: Env, chave: string): boolean {
  return typeof env[chave] === "string" && env[chave]!.trim() !== "";
}

export function checarConfigProducao(env: Env): ResultadoConfig {
  const erros: string[] = [];
  const avisos: string[] = [];

  // BASE_URL: sem ela, cadastro/esqueci-senha/alterar-email/reenviar-verificacao
  // montam o link com "http://localhost:3000" — inútil pra quem recebe o
  // e-mail em produção.
  if (!definida(env, "BASE_URL")) {
    erros.push(
      "BASE_URL não definida — todos os links enviados por e-mail (verificação, redefinição de senha, troca de e-mail) apontariam para http://localhost:3000.",
    );
  }

  // Turnstile: as duas chaves são um par (ver .env.example). Configurar só a
  // secret é o pior cenário: depois de algumas tentativas falhas o login
  // passa a exigir um token de CAPTCHA que o front — sem a site key — nunca
  // consegue renderizar, então a pessoa fica trancada pra fora sem widget
  // pra resolver.
  const temSecretTurnstile = definida(env, "TURNSTILE_SECRET_KEY");
  const temSiteKeyTurnstile = definida(env, "NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  if (temSecretTurnstile !== temSiteKeyTurnstile) {
    erros.push(
      `Turnstile configurado pela metade (TURNSTILE_SECRET_KEY=${temSecretTurnstile ? "definida" : "ausente"}, NEXT_PUBLIC_TURNSTILE_SITE_KEY=${temSiteKeyTurnstile ? "definida" : "ausente"}) — configure as duas ou nenhuma.`,
    );
  } else if (!temSecretTurnstile) {
    avisos.push(
      "Turnstile não configurado — o CAPTCHA de fricção progressiva contra automação está desativado.",
    );
  }

  // Resend: sem a chave, email.ts não instancia o cliente e nenhum e-mail
  // sai — ninguém recebe verificação nem redefinição de senha, e a conta fica
  // sem como ser recuperada. Erro, não aviso. A exceção é o Preview da
  // Vercel, que não tem a chave e não deve cair por isso (lá os links também
  // não vão pro log: ver enviar() em email.ts).
  if (!definida(env, "RESEND_API_KEY")) {
    const mensagem =
      "RESEND_API_KEY não definida — nenhum e-mail é enviado (verificação, redefinição de senha, alertas de segurança).";
    if (env.VERCEL_ENV === "preview") avisos.push(mensagem);
    else erros.push(mensagem);
  } else if (!definida(env, "EMAIL_FROM") || env.EMAIL_FROM!.includes("@resend.dev")) {
    // Com a chave mas no remetente de teste do Resend, o envio "funciona" sem
    // erro nenhum — só que o sandbox entrega apenas pro e-mail dono da conta
    // Resend. Todo o resto (verificação, recuperação de senha, alertas de
    // segurança) some em silêncio.
    avisos.push(
      "EMAIL_FROM ausente ou no domínio de teste do Resend (@resend.dev) — o sandbox só entrega para o dono da conta Resend; os e-mails para usuários não chegam. Verifique um domínio próprio no Resend.",
    );
  }

  // Rollbar: os nomes têm o sufixo numérico gerado pela integração da Vercel
  // (ver .env.example). Server e client são tokens separados.
  const temRollbarServidor = definida(env, "ROLLBAR_AUTH_GATEWAY_SERVER_TOKEN_1787151157");
  const temRollbarCliente = definida(
    env,
    "NEXT_PUBLIC_ROLLBAR_AUTH_GATEWAY_CLIENT_TOKEN_1787151157",
  );
  if (!temRollbarServidor || !temRollbarCliente) {
    const faltando = [
      !temRollbarServidor ? "servidor" : null,
      !temRollbarCliente ? "cliente" : null,
    ].filter(Boolean);
    avisos.push(
      `Rollbar sem token de ${faltando.join(" e ")} — erros inesperados desse lado não são reportados.`,
    );
  }

  // DJANGO_SERVICE_URL: sem ela o rewrite de /api/dominio/* não é registrado
  // (next.config.ts) — o painel sobe, mas projetos/tarefas respondem 404.
  if (!definida(env, "DJANGO_SERVICE_URL")) {
    avisos.push(
      "DJANGO_SERVICE_URL não definida — /api/dominio/* não é encaminhado ao serviço Django (projetos e tarefas ficam indisponíveis).",
    );
  }

  // CRON_SECRET: sem ele, POST /api/cron/limpar-tokens responde 500 e o job
  // de limpeza nunca roda (a tabela de tokens só cresce). Não é falha de
  // segurança (a rota nega acesso), então é aviso, não erro.
  if (!definida(env, "CRON_SECRET")) {
    avisos.push(
      "CRON_SECRET não definida — POST /api/cron/limpar-tokens fica indisponível e a limpeza de tokens expirados não roda.",
    );
  }

  // DATABASE_CA_CERT: sem ela a conexão com o banco é cifrada mas não confere
  // o certificado do servidor (sslmode=no-verify) — ver src/lib/configBanco.ts.
  if (!definida(env, "DATABASE_CA_CERT")) {
    avisos.push(
      "DATABASE_CA_CERT não definida — a conexão com o banco não verifica o certificado do servidor (um intermediário na rede poderia se passar pelo banco).",
    );
  }

  return { erros, avisos };
}
