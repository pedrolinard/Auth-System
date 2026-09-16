import { NextResponse } from "next/server";

import { recusaCron } from "@/lib/autorizacaoCron";
import { processarEntregasWebhook } from "@/lib/webhooks";

// Só a fila de webhooks, pra um agendador mais frequente que o job diário
// (a Vercel Hobby só agenda uma vez por dia). Quem chama hoje: o workflow
// monitor-saude a cada 15 min, quando o repositório tem o segredo CRON_SECRET.
async function processar(req: Request) {
  const recusa = recusaCron(req);
  if (recusa) return recusa;
  const webhooks = await processarEntregasWebhook(undefined, { orcamentoMs: 45_000 });
  return NextResponse.json({ webhooks });
}

export const GET = processar;
export const POST = processar;
