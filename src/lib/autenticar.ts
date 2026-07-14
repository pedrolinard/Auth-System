import "server-only";

import { obterCookieAcesso } from "@/lib/cookies";
import { verificarTokenAcesso } from "@/lib/token";

export async function autenticarRequisicao(req: Request) {
  const cabecalho = req.headers.get("authorization");
  const tokenDoHeader = cabecalho?.startsWith("Bearer ")
    ? cabecalho.slice("Bearer ".length)
    : undefined;

  // Header tem prioridade (fluxo de apps/curl/testes); cookie httpOnly é o
  // caminho do navegador desde a migração do access token pra cookie.
  const token = tokenDoHeader ?? (await obterCookieAcesso());
  if (!token) return null;

  return verificarTokenAcesso(token);
}
