import "server-only";

import Rollbar from "rollbar";

import { CAMPOS_MASCARADOS } from "@/lib/rollbar";

// Campos que só aparecem do lado do servidor, somados à lista do navegador:
// e-mail (dado pessoal, e o alvo de quem quer enumerar contas), segredos da
// aplicação cliente e do MFA, e os nomes OAuth do endpoint de token OIDC.
// `code` fica de fora de propósito: é também o campo do erro do Node e do
// Prisma (ECONNREFUSED, P2002), o que mais ajuda a investigar — e o `code`
// do OAuth só existe no corpo da requisição, que não vai pro Rollbar.
const CAMPOS_MASCARADOS_SERVIDOR = [
  ...CAMPOS_MASCARADOS,
  "email",
  "novoEmail",
  "mfaSecret",
  "senhaHash",
  "client_secret",
  "refresh_token",
  "id_token",
  "code_verifier",
];

// Headers com credencial, se algum dia uma requisição for anexada ao
// relatório (hoje o onRequestError manda só path e método).
const CABECALHOS_MASCARADOS = ["authorization", "cookie", "set-cookie", "x-aplicacao-segredo"];

// scrubFields só alcança chave de objeto e `nome=valor`. Um e-mail DENTRO de
// um texto (mensagem de erro, stack, "falha ao enviar pra fulano@x.com") passa
// direto — então todo texto do relatório passa por aqui antes de sair.
const PADRAO_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function mascararEmails(valor: unknown): unknown {
  if (typeof valor === "string") return valor.replace(PADRAO_EMAIL, "[email]");
  if (Array.isArray(valor)) {
    for (let i = 0; i < valor.length; i++) valor[i] = mascararEmails(valor[i]);
    return valor;
  }
  if (valor && typeof valor === "object") {
    const objeto = valor as Record<string, unknown>;
    for (const chave of Object.keys(objeto)) objeto[chave] = mascararEmails(objeto[chave]);
    return objeto;
  }
  return valor;
}

// Instância única do lado servidor — usada em src/instrumentation.ts
// (onRequestError) pra capturar qualquer erro de servidor não tratado
// (Server Components, Route Handlers, Server Actions), sem precisar de
// try/catch espalhado em cada rota de API.
export const rollbarServidor = new Rollbar({
  accessToken: process.env.ROLLBAR_AUTH_GATEWAY_SERVER_TOKEN_1787151157,
  captureUncaught: true,
  captureUnhandledRejections: true,
  // IP truncado, como no cliente (src/lib/rollbar.ts).
  captureIp: "anonymize",
  scrubFields: CAMPOS_MASCARADOS_SERVIDOR,
  scrubHeaders: CABECALHOS_MASCARADOS,
  transform: (dados) => {
    mascararEmails(dados);
  },
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
});
