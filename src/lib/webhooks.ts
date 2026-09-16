import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { after } from "next/server";

import { criptografar, descriptografar } from "@/lib/cripto";
import { prisma } from "@/lib/db";
import type { EventoWebhook } from "@/lib/eventosWebhook";
import { postarParaUrlExterna } from "@/lib/requisicaoExterna";

// Webhooks: o provedor avisa o sistema de uma aplicação cliente quando algo
// acontece com as contas dela. Cada evento vira uma EntregaWebhook persistida
// ANTES de enviar; o envio sai depois da resposta (after) e, se falhar, volta
// pra fila com espera crescente. A fila anda de carona no after() de qualquer
// evento novo e no job diário: as esperas abaixo são o MÍNIMO, e numa
// aplicação sem movimento a retentativa pode esperar até o próximo job.
//
// Assinatura, no formato que os clientes já conhecem de outros provedores:
//   x-auth-gateway-assinatura: t=<unix>,v1=<hex HMAC-SHA256(segredo, "<t>.<corpo>")>
// O cliente confere o HMAC em tempo constante e recusa `t` velho (replay).

export { EVENTOS_WEBHOOK, type EventoWebhook } from "@/lib/eventosWebhook";

// 1 min, 5 min, 30 min, 2 h, 12 h — depois da sexta tentativa, desiste.
const ESPERAS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];
const MAX_TENTATIVAS = ESPERAS_MS.length + 1;
export const MAX_WEBHOOKS_POR_APLICACAO = 5;

export function gerarSegredoWebhook(): { segredo: string; cifrado: string } {
  const segredo = `whsec_${randomBytes(32).toString("base64url")}`;
  return { segredo, cifrado: criptografar(segredo) };
}

export function assinarCorpo(segredo: string, corpo: string, instante: number): string {
  const assinatura = createHmac("sha256", segredo).update(`${instante}.${corpo}`).digest("hex");
  return `t=${instante},v1=${assinatura}`;
}

/**
 * Registra o evento pros webhooks ativos da aplicação que o assinam e agenda o
 * envio pra depois da resposta. Best-effort: nunca derruba o fluxo que
 * originou o evento (cadastro, troca de senha...). Aplicação padrão não tem
 * webhooks — ela é o próprio painel.
 */
export async function emitirEventoWebhook(
  aplicacaoId: string,
  evento: EventoWebhook,
  dados: Record<string, unknown>,
): Promise<void> {
  try {
    const webhooks = await prisma.webhookAplicacao.findMany({
      // Só aplicação APROVADA recebe: sem aprovação, o provedor não sai
      // fazendo requisições pra URLs escolhidas por uma conta recém-criada.
      where: { aplicacaoId, ativo: true, eventos: { has: evento }, aplicacao: { padrao: false, aprovada: true } },
      select: { id: true },
    });
    if (webhooks.length === 0) return;
    const criadoEm = new Date();
    const ids: string[] = [];
    for (const webhook of webhooks) {
      const entrega = await prisma.entregaWebhook.create({
        data: {
          webhookId: webhook.id,
          evento,
          // Montado aqui, campo a campo pelo chamador: nada de objeto do banco
          // inteiro (hash de senha, segredo de MFA) indo pra fora.
          payload: { evento, criadoEm: criadoEm.toISOString(), dados } as object,
          // Relógio da aplicação (não o DEFAULT do banco): o arrendamento
          // compara com `new Date()` daqui, e uma diferença de relógio entre
          // os dois faria a entrega recém-criada parecer "do futuro".
          proximaTentativaEm: criadoEm,
        },
        select: { id: true },
      });
      ids.push(entrega.id);
    }
    agendar(ids);
  } catch (erro) {
    console.error(`Falha ao registrar evento de webhook ${evento}:`, erro);
  }
}

function agendar(ids: string[]) {
  try {
    after(async () => {
      await processarEntregasWebhook(ids);
      // Aproveita a carona pra tentar de novo um lote pequeno de entregas que
      // falharam e já passaram do horário: sem isso, as retentativas só
      // rodariam no job diário (a Vercel Hobby não agenda com mais
      // frequência) e uma falha passageira esperaria até um dia.
      await processarEntregasWebhook(undefined, { lote: 10, orcamentoMs: 20_000 });
    });
  } catch {
    // Fora de uma requisição (script, teste de lib): o job envia.
  }
}

// Quanto tempo uma entrega fica "arrendada" por quem vai enviá-la. Dentro
// disso, o after() de outro evento, o job e o botão de teste não pegam a mesma
// entrega — sem a trava, os três podiam enviar em dobro e perder incremento de
// tentativas. Maior que o prazo de um envio (10 s) com folga.
const ARRENDAMENTO_MS = 2 * 60 * 1000;

type ResultadoEntrega = "entregue" | "falha" | "ignorada";

async function entregar(id: string): Promise<ResultadoEntrega> {
  const agora = new Date();
  const { count } = await prisma.entregaWebhook.updateMany({
    where: { id, entregueEm: null, desistiuEm: null, proximaTentativaEm: { lte: agora } },
    data: { proximaTentativaEm: new Date(agora.getTime() + ARRENDAMENTO_MS) },
  });
  if (count !== 1) return "ignorada"; // já entregue, desistida ou com outro processo

  const entrega = await prisma.entregaWebhook.findUnique({
    where: { id },
    include: { webhook: { select: { url: true, segredoCifrado: true, ativo: true } } },
  });
  if (!entrega) return "ignorada";
  if (!entrega.webhook.ativo) {
    await prisma.entregaWebhook.update({ where: { id }, data: { desistiuEm: new Date(), ultimoErro: "Webhook desativado." } });
    return "falha";
  }

  const corpo = JSON.stringify({ id: entrega.id, ...(entrega.payload as object) });
  const instante = Math.floor(Date.now() / 1000);
  const resultado = await postarParaUrlExterna(entrega.webhook.url, corpo, {
    "Content-Type": "application/json",
    "User-Agent": "AuthGateway-Webhooks/1",
    "x-auth-gateway-evento": entrega.evento,
    "x-auth-gateway-entrega": entrega.id,
    "x-auth-gateway-assinatura": assinarCorpo(descriptografar(entrega.webhook.segredoCifrado), corpo, instante),
  });

  const tentativas = entrega.tentativas + 1;
  if (resultado.ok) {
    await prisma.entregaWebhook.update({
      where: { id },
      data: { tentativas, entregueEm: new Date(), ultimoStatus: resultado.status, ultimoErro: null },
    });
    return "entregue";
  }
  const desistir = tentativas >= MAX_TENTATIVAS;
  await prisma.entregaWebhook.update({
    where: { id },
    data: {
      tentativas,
      ultimoStatus: resultado.status,
      ultimoErro: resultado.erro ?? `Resposta ${resultado.status}`,
      ...(desistir
        ? { desistiuEm: new Date() }
        : { proximaTentativaEm: new Date(Date.now() + ESPERAS_MS[tentativas - 1]) }),
    },
  });
  if (desistir) await desligarSeFalhandoSempre(entrega.webhookId);
  return "falha";
}

// Tantas entregas SEGUIDAS desistidas (cada uma já com todas as tentativas):
// o destino está quebrado há dias. Desliga em vez de seguir martelando, e o
// painel mostra por quê.
const DESISTENCIAS_SEGUIDAS_PARA_DESLIGAR = 5;

async function desligarSeFalhandoSempre(webhookId: string) {
  const ultimas = await prisma.entregaWebhook.findMany({
    where: { webhookId, OR: [{ entregueEm: { not: null } }, { desistiuEm: { not: null } }] },
    orderBy: { criadoEm: "desc" },
    take: DESISTENCIAS_SEGUIDAS_PARA_DESLIGAR,
    select: { desistiuEm: true },
  });
  if (ultimas.length === DESISTENCIAS_SEGUIDAS_PARA_DESLIGAR && ultimas.every((e) => e.desistiuEm)) {
    await prisma.webhookAplicacao.update({
      where: { id: webhookId },
      data: {
        ativo: false,
        desativadoMotivo: `Desligado automaticamente após ${DESISTENCIAS_SEGUIDAS_PARA_DESLIGAR} entregas seguidas sem sucesso.`,
      },
    });
  }
}

/**
 * Envia as entregas indicadas ou, sem lista, as pendentes cujo horário de
 * tentativa já chegou. Sequencial, com lote e orçamento de tempo: cada envio
 * tem prazo absoluto de 10 s, e o lote para quando o orçamento acaba, pra um
 * sistema de cliente lento não prender a função até ela estourar.
 */
export async function processarEntregasWebhook(
  ids?: string[],
  opcoes: { lote?: number; orcamentoMs?: number } = {},
): Promise<{ entregues: number; falhas: number }> {
  const inicio = Date.now();
  const orcamentoMs = opcoes.orcamentoMs ?? 60_000;
  const pendentes = ids
    ? ids
    : (
        await prisma.entregaWebhook.findMany({
          where: { entregueEm: null, desistiuEm: null, proximaTentativaEm: { lte: new Date() } },
          orderBy: { proximaTentativaEm: "asc" },
          take: opcoes.lote ?? 50,
          select: { id: true },
        })
      ).map((e) => e.id);

  let entregues = 0;
  let falhas = 0;
  for (const id of pendentes) {
    if (Date.now() - inicio > orcamentoMs) break;
    try {
      const resultado = await entregar(id);
      if (resultado === "entregue") entregues++;
      else if (resultado === "falha") falhas++;
    } catch (erro) {
      falhas++;
      console.error(`Falha ao entregar webhook ${id}:`, erro);
    }
  }
  return { entregues, falhas };
}

/**
 * Dados de conta que podem sair num webhook: o id (o que o sistema do cliente
 * usa pra achar a conta) e o e-mail (o que ele precisa pra conciliar com a
 * base dele). Nada além — nome, hash de senha, segredo de MFA ficam de fora.
 */
export function dadosDoUsuario(usuario: { id: string; email?: string }) {
  return { usuario: { id: usuario.id, ...(usuario.email ? { email: usuario.email } : {}) } };
}
