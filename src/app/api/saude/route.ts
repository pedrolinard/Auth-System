import { NextResponse } from "next/server";
import { obterChaveAtiva } from "@/lib/chavesAssinatura";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Checagem de saúde pra um monitor externo de disponibilidade (ver
// docs/operacao.md). Verifica as duas coisas sem as quais nenhum login
// funciona: o banco responde e existe uma chave pra assinar tokens. Responde
// 503 se qualquer uma falhar — um monitor que só olha "o servidor respondeu"
// continuaria verde com o banco fora do ar.
//
// Público e sem detalhe de erro de propósito: diz O QUE está fora, nunca por
// quê (mensagem de exceção de banco carrega host, usuário, versão).
export async function GET() {
  const [banco, chaveAssinatura] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => "ok" as const).catch(() => "falha" as const),
    obterChaveAtiva().then(() => "ok" as const).catch(() => "falha" as const),
  ]);
  const saudavel = banco === "ok" && chaveAssinatura === "ok";

  return NextResponse.json(
    { status: saudavel ? "ok" : "degradado", banco, chaveAssinatura },
    {
      status: saudavel ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
