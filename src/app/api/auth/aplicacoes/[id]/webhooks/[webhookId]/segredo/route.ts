import { NextResponse } from "next/server";

import { registrarEvento } from "@/lib/auditoria";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { alvoAplicacao, autenticarGestorAplicacoes, carregarAplicacaoDoGestor } from "@/lib/gestaoAplicacoes";
import { gerarSegredoWebhook } from "@/lib/webhooks";

// Troca o segredo de assinatura do webhook. O anterior deixa de assinar na
// hora — o sistema do cliente precisa passar a conferir com o novo.
export async function POST(
  req: Request,
  { params }: RouteContext<"/api/auth/aplicacoes/[id]/webhooks/[webhookId]/segredo">,
) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }
  const acesso = await autenticarGestorAplicacoes(req);
  if (!acesso.ok) return NextResponse.json({ erro: acesso.erro }, { status: acesso.status });
  const { id, webhookId } = await params;
  const aplicacao = await carregarAplicacaoDoGestor(acesso.gestor, id);
  if (!aplicacao) return NextResponse.json({ erro: "Webhook não encontrado." }, { status: 404 });

  const { segredo, cifrado } = gerarSegredoWebhook();
  const { count } = await prisma.webhookAplicacao.updateMany({
    where: { id: webhookId, aplicacaoId: aplicacao.id },
    data: { segredoCifrado: cifrado },
  });
  if (count !== 1) return NextResponse.json({ erro: "Webhook não encontrado." }, { status: 404 });

  await registrarEvento({
    req,
    evento: "segredo_webhook_rotacionado",
    autorId: acesso.gestor.payload.sub,
    autorEmail: acesso.gestor.payload.email,
    aplicacaoId: acesso.gestor.payload.aplicacaoId,
    alvo: alvoAplicacao(aplicacao),
  });
  return NextResponse.json({ segredo });
}
