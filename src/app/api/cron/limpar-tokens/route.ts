import { NextResponse } from "next/server";
import { recusaCron } from "@/lib/autorizacaoCron";
import { processarExclusoesDominio } from "@/lib/exclusaoDominio";
import { limparTokensExpirados } from "@/lib/limpezaTokens";
import { processarEntregasWebhook } from "@/lib/webhooks";

// Rota pensada para ser chamada por um agendador, não pelo navegador — por
// isso a autorização é por segredo compartilhado em vez de sessão de usuário.
// Em produção quem chama é o Vercel Cron (vercel.json), que faz GET e manda
// `Authorization: Bearer $CRON_SECRET` sozinho; o POST continua pra quem
// agenda por fora (scripts/limpar-tokens.mjs, cron do SO).
async function limpar(req: Request) {
  const recusa = recusaCron(req);
  if (recusa) return recusa;

  const resultado = await limparTokensExpirados();
  // Reenvia ao Django as exclusões de dados que falharam na hora (serviço
  // fora do ar quando a conta foi excluída) — ver exclusaoDominio.ts.
  const exclusoesDominio = await processarExclusoesDominio();
  // Webhooks que falharam e já chegaram no horário da próxima tentativa.
  const webhooks = await processarEntregasWebhook();
  // `removidos` continua sendo o total (compat com quem só olha o número);
  // o detalhamento por tabela vai junto pra observabilidade do job.
  return NextResponse.json({
    removidos:
      resultado.tokens + resultado.auditoria + resultado.desafiosMfa + resultado.limitesTaxa,
    detalhe: { ...resultado, exclusoesDominio, webhooks },
  });
}

export const GET = limpar;
export const POST = limpar;
