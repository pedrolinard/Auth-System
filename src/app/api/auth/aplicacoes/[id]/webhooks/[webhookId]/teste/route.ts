import { NextResponse } from "next/server";

import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import { autenticarGestorAplicacoes, carregarAplicacaoDoGestor } from "@/lib/gestaoAplicacoes";
import { limiteExcedido, registrarTentativaIp } from "@/lib/rateLimit";
import { processarEntregasWebhook } from "@/lib/webhooks";

// Manda um evento webhook.teste agora e diz se chegou. Útil pra conferir a
// URL e a verificação da assinatura do lado do cliente. Só em aplicação
// aprovada (mesmo motivo de os eventos reais só saírem aprovados) e com
// limite: sem ele, o botão vira um disparador de requisições a uma URL
// qualquer.
const MAX_TESTES = 10;
const JANELA_TESTES_MS = 10 * 60 * 1000;

export async function POST(
  req: Request,
  { params }: RouteContext<"/api/auth/aplicacoes/[id]/webhooks/[webhookId]/teste">,
) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }
  const acesso = await autenticarGestorAplicacoes(req);
  if (!acesso.ok) return NextResponse.json({ erro: acesso.erro }, { status: acesso.status });
  const { id, webhookId } = await params;
  const aplicacao = await carregarAplicacaoDoGestor(acesso.gestor, id);
  const webhook = aplicacao
    ? await prisma.webhookAplicacao.findFirst({ where: { id: webhookId, aplicacaoId: aplicacao.id }, select: { id: true } })
    : null;
  if (!aplicacao || !webhook) return NextResponse.json({ erro: "Webhook não encontrado." }, { status: 404 });
  if (!aplicacao.aprovada) {
    return NextResponse.json(
      { erro: "Webhooks só são enviados depois que quem opera o provedor aprovar a aplicação." },
      { status: 403 },
    );
  }

  const chave = `webhook:${webhook.id}`;
  if (await limiteExcedido({ ip: chave, evento: "webhook_teste", maximo: MAX_TESTES })) {
    return NextResponse.json({ erro: "Muitos testes seguidos. Tente de novo em alguns minutos." }, { status: 429 });
  }
  await registrarTentativaIp({ ip: chave, evento: "webhook_teste", janelaMs: JANELA_TESTES_MS });

  const agora = new Date();
  const entrega = await prisma.entregaWebhook.create({
    data: {
      webhookId: webhook.id,
      evento: "webhook.teste",
      payload: { evento: "webhook.teste", criadoEm: agora.toISOString(), dados: {} },
      // Relógio da aplicação, o mesmo que o arrendamento compara.
      proximaTentativaEm: agora,
    },
    select: { id: true },
  });
  await processarEntregasWebhook([entrega.id]);
  const resultado = await prisma.entregaWebhook.findUniqueOrThrow({
    where: { id: entrega.id },
    select: { entregueEm: true, ultimoStatus: true, ultimoErro: true },
  });
  // Teste não entra na fila de retentativas: a resposta já foi dada agora.
  if (!resultado.entregueEm) {
    await prisma.entregaWebhook.update({ where: { id: entrega.id }, data: { desistiuEm: new Date() } });
  }
  return NextResponse.json({
    entregue: resultado.entregueEm !== null,
    status: resultado.ultimoStatus,
    erro: resultado.ultimoErro,
  });
}
