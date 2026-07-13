import "server-only";

import { verificarTokenAcesso } from "@/lib/token";

export async function autenticarRequisicao(req: Request) {
  const cabecalho = req.headers.get("authorization");
  const token = cabecalho?.startsWith("Bearer ")
    ? cabecalho.slice("Bearer ".length)
    : undefined;

  if (!token) return null;

  return verificarTokenAcesso(token);
}
