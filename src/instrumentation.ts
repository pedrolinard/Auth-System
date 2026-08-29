import type { Instrumentation } from "next";

// Chamado uma única vez quando um servidor Next.js sobe, antes de ele aceitar
// requisições. Usado aqui pra uma checagem de sanidade da config de
// produção: vários recursos (CAPTCHA, e-mail, observabilidade, links de
// e-mail) degradam em silêncio quando falta a env var, o que passa
// despercebido num deploy. Ver src/lib/configProducao.ts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;
  // `register` também roda durante `next build` (fase de análise/prerender) —
  // aí as env vars de runtime podem não estar todas presentes ainda, e não
  // faz sentido derrubar o build por causa disso. A checagem é sobre a
  // instância que vai SERVIR, então roda só no boot de verdade.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { checarConfigProducao } = await import("@/lib/configProducao");
  const { erros, avisos } = checarConfigProducao(process.env);

  for (const aviso of avisos) {
    console.warn(`[config:produção] ${aviso}`);
  }

  if (erros.length > 0) {
    // `register` precisa terminar antes do servidor ficar pronto — lançar
    // aqui impede a instância de servir com uma config que deixaria usuários
    // trancados pra fora ou links de e-mail quebrados. Melhor o deploy
    // falhar visível do que degradar em silêncio.
    throw new Error(
      `Configuração de produção inválida:\n- ${erros.join("\n- ")}`,
    );
  }
}

// Captura qualquer erro de servidor não tratado (Server Components, Route
// Handlers, Server Actions) e manda pro Rollbar — sem precisar de
// try/catch espalhado em cada rota de API. Next.js chama isso
// automaticamente quando o próprio servidor captura o erro.
export const onRequestError: Instrumentation.onRequestError = async (
  erro,
  requisicao,
  contexto,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { rollbarServidor } = await import("@/lib/rollbarServidor");
  rollbarServidor.error(erro as Error, {
    path: requisicao.path,
    method: requisicao.method,
    routePath: contexto.routePath,
    routeType: contexto.routeType,
  });
};
