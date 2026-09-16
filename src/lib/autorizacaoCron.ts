import "server-only";

import { NextResponse } from "next/server";

import { compararEmTempoConstante } from "@/lib/cripto";

/**
 * Autoriza uma rota de agendador pelo segredo compartilhado CRON_SECRET
 * (`Authorization: Bearer ...`). Devolve a resposta de recusa, ou null se
 * autorizado.
 */
export function recusaCron(req: Request): NextResponse | null {
  const segredoConfigurado = process.env.CRON_SECRET;
  if (!segredoConfigurado) {
    return NextResponse.json({ erro: "CRON_SECRET não configurado no servidor." }, { status: 500 });
  }
  const cabecalho = req.headers.get("authorization");
  const segredoRecebido = cabecalho?.startsWith("Bearer ") ? cabecalho.slice("Bearer ".length) : undefined;
  // Comparação em tempo constante, mesma disciplina do token CSRF — um `!==`
  // aqui vaza, pela latência, quantos bytes iniciais do CRON_SECRET o
  // atacante acertou.
  if (!segredoRecebido || !compararEmTempoConstante(segredoRecebido, segredoConfigurado)) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }
  return null;
}
