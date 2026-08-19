import type { Instrumentation } from "next";

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
