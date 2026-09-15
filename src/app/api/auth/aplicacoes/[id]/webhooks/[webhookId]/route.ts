import { NextResponse } from "next/server";

import { registrarEvento } from "@/lib/auditoria";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { prisma } from "@/lib/db";
import {
  alvoAplicacao,
  autenticarGestorAplicacoes,
  carregarAplicacaoDoGestor,
  urlEhDoProvedor,
} from "@/lib/gestaoAplicacoes";
import { esquemaAtualizarWebhook } from "@/lib/validacao";

type Contexto = RouteContext<"/api/auth/aplicacoes/[id]/webhooks/[webhookId]">;

async function carregar(req: Request, { params }: Contexto) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return { resposta: NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 }) } as const;
  }
  const acesso = await autenticarGestorAplicacoes(req);
  if (!acesso.ok) return { resposta: NextResponse.json({ erro: acesso.erro }, { status: acesso.status }) } as const;
  const { id, webhookId } = await params;
  const aplicacao = await carregarAplicacaoDoGestor(acesso.gestor, id);
  const webhook = aplicacao
    ? await prisma.webhookAplicacao.findFirst({ where: { id: webhookId, aplicacaoId: aplicacao.id }, select: { id: true } })
    : null;
  if (!aplicacao || !webhook) {
    return { resposta: NextResponse.json({ erro: "Webhook não encontrado." }, { status: 404 }) } as const;
  }
  return { gestor: acesso.gestor, aplicacao, webhook } as const;
}

export async function PATCH(req: Request, contexto: Contexto) {
  const carregado = await carregar(req, contexto);
  if ("resposta" in carregado) return carregado.resposta;

  const dados = esquemaAtualizarWebhook.safeParse(await req.json().catch(() => null));
  if (!dados.success) {
    return NextResponse.json({ erro: dados.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  }
  if (dados.data.url && urlEhDoProvedor(req, dados.data.url)) {
    return NextResponse.json({ erro: "O webhook não pode apontar pro próprio provedor." }, { status: 400 });
  }
  const webhook = await prisma.webhookAplicacao.update({
    where: { id: carregado.webhook.id },
    data: {
      ...dados.data,
      // Religar limpa o motivo do desligamento automático.
      ...(dados.data.ativo === true ? { desativadoMotivo: null } : {}),
    },
    select: { id: true, url: true, eventos: true, ativo: true, desativadoMotivo: true, criadoEm: true },
  });
  await registrarEvento({
    req,
    evento: "webhook_atualizado",
    autorId: carregado.gestor.payload.sub,
    autorEmail: carregado.gestor.payload.email,
    aplicacaoId: carregado.gestor.payload.aplicacaoId,
    alvo: alvoAplicacao(carregado.aplicacao),
  });
  return NextResponse.json({ webhook });
}

export async function DELETE(req: Request, contexto: Contexto) {
  const carregado = await carregar(req, contexto);
  if ("resposta" in carregado) return carregado.resposta;
  await prisma.webhookAplicacao.delete({ where: { id: carregado.webhook.id } });
  await registrarEvento({
    req,
    evento: "webhook_excluido",
    autorId: carregado.gestor.payload.sub,
    autorEmail: carregado.gestor.payload.email,
    aplicacaoId: carregado.gestor.payload.aplicacaoId,
    alvo: alvoAplicacao(carregado.aplicacao),
  });
  return NextResponse.json({ sucesso: true });
}
