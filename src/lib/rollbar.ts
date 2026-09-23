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
  // IP truncado (último octeto zerado): investigar um erro não precisa saber
  // exatamente quem o teve. LGPD, ver docs/juridico/registro-operacoes-tratamento.md.
  captureIp: "anonymize" as const,
  // Somados à lista padrão do rollbar.js (que tem password/access_token, mas
  // não `token`): os links de e-mail (redefinir senha, verificar e trocar
  // e-mail, aceitar convite) trazem o token em `?token=`, e a URL da página
  // vai em todo erro e no rastro de navegação. O mascaramento vale pra
  // chave de objeto com esse nome e pra `nome=valor` dentro de qualquer string.
  scrubFields: ["token", "mfaToken", "refreshToken", "senha", "senhaAtual", "novaSenha", "codigo", "segredo", "clientSecret"],
  // O rastro de telemetria guarda o que foi digitado nos campos (o rollbar.js
  // só esconde type="password"): código de MFA, código de backup e e-mail
  // iriam junto com o erro.
  scrubTelemetryInputs: true,
  // NEXT_PUBLIC_VERCEL_ENV é exposta automaticamente pela Vercel pro
  // client (VERCEL_ENV sozinha não seria) — distingue production/preview/
  // development nos 3 ambientes.
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
};
