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
import { esquemaCriarWebhook } from "@/lib/validacao";
import { gerarSegredoWebhook, MAX_WEBHOOKS_POR_APLICACAO } from "@/lib/webhooks";

// Webhooks de uma aplicação: listar (com as últimas entregas) e cadastrar.
// Mesmo escopo da gestão de aplicações: aplicação de outra organização é 404.

const SELECAO_WEBHOOK = {
  id: true,
  url: true,
  eventos: true,
  ativo: true,
  desativadoMotivo: true,
  criadoEm: true,
  // Das entregas, só o que ajuda a diagnosticar a integração — nunca o corpo
  // da resposta do destino (não pode virar oráculo de requisição interna).
  entregas: {
    orderBy: { criadoEm: "desc" },
    take: 10,
    select: {
      id: true,
      evento: true,
      tentativas: true,
      entregueEm: true,
      desistiuEm: true,
      proximaTentativaEm: true,
      ultimoStatus: true,
      ultimoErro: true,
      criadoEm: true,
    },
  },
} as const;

export async function GET(req: Request, { params }: RouteContext<"/api/auth/aplicacoes/[id]/webhooks">) {
  const acesso = await autenticarGestorAplicacoes(req);
  if (!acesso.ok) return NextResponse.json({ erro: acesso.erro }, { status: acesso.status });
  const { id } = await params;
  const aplicacao = await carregarAplicacaoDoGestor(acesso.gestor, id);
  if (!aplicacao) return NextResponse.json({ erro: "Aplicação não encontrada." }, { status: 404 });

  const webhooks = await prisma.webhookAplicacao.findMany({
    where: { aplicacaoId: aplicacao.id },
    orderBy: { criadoEm: "asc" },
    select: SELECAO_WEBHOOK,
  });
  return NextResponse.json({ webhooks, recebeEventos: aplicacao.aprovada });
}

// O segredo de assinatura aparece só nesta resposta (e na rotação).
export async function POST(req: Request, { params }: RouteContext<"/api/auth/aplicacoes/[id]/webhooks">) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }
  const acesso = await autenticarGestorAplicacoes(req);
  if (!acesso.ok) return NextResponse.json({ erro: acesso.erro }, { status: acesso.status });
  const { id } = await params;
  const aplicacao = await carregarAplicacaoDoGestor(acesso.gestor, id);
  if (!aplicacao) return NextResponse.json({ erro: "Aplicação não encontrada." }, { status: 404 });

  const dados = esquemaCriarWebhook.safeParse(await req.json().catch(() => null));
  if (!dados.success) {
    return NextResponse.json({ erro: dados.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  }
  if (urlEhDoProvedor(req, dados.data.url)) {
    return NextResponse.json({ erro: "O webhook não pode apontar pro próprio provedor." }, { status: 400 });
  }
  const total = await prisma.webhookAplicacao.count({ where: { aplicacaoId: aplicacao.id } });
  if (total >= MAX_WEBHOOKS_POR_APLICACAO) {
    return NextResponse.json(
      { erro: `Esta aplicação já tem ${total} webhooks, o máximo permitido.` },
      { status: 403 },
    );
  }

  const { segredo, cifrado } = gerarSegredoWebhook();
  const webhook = await prisma.webhookAplicacao.create({
    data: { aplicacaoId: aplicacao.id, url: dados.data.url, eventos: dados.data.eventos, segredoCifrado: cifrado },
    select: SELECAO_WEBHOOK,
  });
  await registrarEvento({
    req,
    evento: "webhook_criado",
    autorId: acesso.gestor.payload.sub,
    autorEmail: acesso.gestor.payload.email,
    aplicacaoId: acesso.gestor.payload.aplicacaoId,
    alvo: alvoAplicacao(aplicacao),
  });
  return NextResponse.json({ webhook, segredo }, { status: 201 });
}
