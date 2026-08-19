// SEM "server-only": importado tanto do layout raiz (Server Component,
// pra passar a prop pro RollbarProvider) quanto de global-error.tsx (Client
// Component — precisa instanciar seu próprio Rollbar ali, já que o
// RollbarProvider do layout não está disponível quando o layout raiz em si
// quebra). O token aqui é o NEXT_PUBLIC_* (client), já pensado pra ir pro
// browser — a instância de servidor fica em `rollbarServidor.ts`, essa sim
// com "server-only".
//
// Nomes reais das env vars criadas pela integração Rollbar do Vercel
// Marketplace (`vercel integration add rollbar/error-tracking`) — o sufixo
// numérico é gerado pela Vercel pra identificar o recurso, não é escolha
// nossa (ver `vercel env ls`).
export const configCliente = {
  accessToken: process.env.NEXT_PUBLIC_ROLLBAR_AUTH_GATEWAY_CLIENT_TOKEN_1787151157,
  captureUncaught: true,
  captureUnhandledRejections: true,
  // NEXT_PUBLIC_VERCEL_ENV é exposta automaticamente pela Vercel pro
  // client (VERCEL_ENV sozinha não seria) — distingue production/preview/
  // development nos 3 ambientes.
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
};
