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
//   - sem RESEND_API_KEY:            e-mails só são logados no console
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

  // Resend: sem a chave, email.ts não instancia o cliente e cai no modo
  // "loga o link no console" — em produção isso significa que ninguém
  // recebe e-mail de verificação nem de redefinição de senha.
  if (!definida(env, "RESEND_API_KEY")) {
    avisos.push(
      "RESEND_API_KEY não definida — nenhum e-mail é enviado de verdade (o conteúdo só vai para o log do servidor).",
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

  // CRON_SECRET: sem ele, POST /api/cron/limpar-tokens responde 500 e o job
  // de limpeza nunca roda (a tabela de tokens só cresce). Não é falha de
  // segurança (a rota nega acesso), então é aviso, não erro.
  if (!definida(env, "CRON_SECRET")) {
    avisos.push(
      "CRON_SECRET não definida — POST /api/cron/limpar-tokens fica indisponível e a limpeza de tokens expirados não roda.",
    );
  }

  return { erros, avisos };
}
