import { NextResponse } from "next/server";
import { limparTokensExpirados } from "@/lib/limpezaTokens";

// Rota pensada para ser chamada por um agendador externo (cron job do SO,
// Task Scheduler, Vercel Cron, etc.), não pelo navegador — por isso a
// autorização é por segredo compartilhado em vez de sessão de usuário.
export async function POST(req: Request) {
  const segredoConfigurado = process.env.CRON_SECRET;
  if (!segredoConfigurado) {
    return NextResponse.json(
      { erro: "CRON_SECRET não configurado no servidor." },
      { status: 500 },
    );
  }

  const cabecalho = req.headers.get("authorization");
  const segredoRecebido = cabecalho?.startsWith("Bearer ")
    ? cabecalho.slice("Bearer ".length)
    : undefined;

  if (segredoRecebido !== segredoConfigurado) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  const removidos = await limparTokensExpirados();
  return NextResponse.json({ removidos });
}
