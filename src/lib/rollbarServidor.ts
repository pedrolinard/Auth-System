import "server-only";

import Rollbar from "rollbar";

// Instância única do lado servidor — usada em src/instrumentation.ts
// (onRequestError) pra capturar qualquer erro de servidor não tratado
// (Server Components, Route Handlers, Server Actions), sem precisar de
// try/catch espalhado em cada rota de API.
export const rollbarServidor = new Rollbar({
  accessToken: process.env.ROLLBAR_AUTH_GATEWAY_SERVER_TOKEN_1787151157,
  captureUncaught: true,
  captureUnhandledRejections: true,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
});
