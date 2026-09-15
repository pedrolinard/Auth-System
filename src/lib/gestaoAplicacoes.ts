import "server-only";

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { autenticarRequisicao } from "@/lib/autenticar";
import { hostDaRequisicao } from "@/lib/aplicacao";
import { hashToken, type PayloadTokenAcesso } from "@/lib/token";

// Gestão de aplicações (Fase 01 do provedor): criar, editar, desativar e
// rotacionar o segredo dos clientes que integram com este provedor.

// Teto de aplicações no self-service, pra uma conta nova não criar centenas de
// clientes. Contado por CONTA (somando as organizações de que ela é dona ou
// admin), não só por organização: criar organizações é livre, e um teto só
// por organização se multiplicava por quantas a pessoa abrisse. Quem opera o
// provedor não tem teto.
export const MAX_APLICACOES_POR_CONTA = 3;

export function contarAplicacoesDaConta(usuarioId: string) {
  return prisma.aplicacao.count({
    where: {
      organizacaoDona: { membros: { some: { usuarioId, papel: { in: ["dono", "admin"] } } } },
    },
  });
}

/**
 * Aplicação cliente não pode declarar o domínio do PRÓPRIO provedor como
 * origem nem como RP ID: seria uma página de terceiro "falando" como o painel
 * (origem aceita nas rotas e no WebAuthn) ou passkeys de cliente presas a um
 * domínio que cobre o do provedor.
 */
export function conflitoComDominioDoProvedor(
  req: Request,
  dados: { origens: string[]; passkeyRpId: string | null },
): string | null {
  // Origem compara host COM porta (http://localhost:5173 de um cliente em dev
  // não é o provedor em localhost:3000); RP ID compara só o nome, que é como
  // o WebAuthn o aplica.
  const hostsProvedor = new Set<string>();
  const hostReq = hostDaRequisicao(req);
  if (hostReq) hostsProvedor.add(hostReq.toLowerCase());
  if (process.env.BASE_URL) {
    try {
      hostsProvedor.add(new URL(process.env.BASE_URL).host.toLowerCase());
    } catch {
      // BASE_URL inválida já é erro de boot em produção (configProducao.ts).
    }
  }

  for (const origem of dados.origens) {
    if (hostsProvedor.has(new URL(origem).host.toLowerCase())) {
      return `A origem ${origem} é o domínio do próprio provedor e não pode ser usada por uma aplicação cliente.`;
    }
  }
  const rpId = dados.passkeyRpId?.toLowerCase();
  if (rpId) {
    for (const hostComPorta of hostsProvedor) {
      const host = hostComPorta.split(":")[0];
      if (host === rpId || host.endsWith(`.${rpId}`)) {
        return `O RP ID "${dados.passkeyRpId}" cobre o domínio do próprio provedor e não pode ser usado por uma aplicação cliente.`;
      }
    }
  }
  return null;
}

export type GestorAplicacoes = {
  payload: PayloadTokenAcesso;
  // Vê e gerencia todas as aplicações, inclusive a padrão.
  operador: boolean;
  // Self-service: a organização cujas aplicações esta sessão gerencia (null
  // para o operador).
  organizacaoDonaId: string | null;
};

/**
 * Quem pode gerenciar aplicações pelo painel:
 *
 * - o OPERADOR do provedor — admin de SISTEMA com conta na aplicação padrão:
 *   todas. As duas condições são necessárias: um admin de sistema DENTRO da
 *   aplicação de um cliente não pode enxergar as aplicações dos outros;
 * - SELF-SERVICE: dono ou admin da organização ativa, com conta na aplicação
 *   padrão e e-mail verificado: só as aplicações daquela organização. Conta
 *   de usuário final de um cliente nunca entra aqui — mesmo motivo do
 *   operador exigir a aplicação padrão. E-mail verificado porque uma conta
 *   criada com o e-mail de outra pessoa não pode sair emitindo client
 *   secrets.
 */
export async function autenticarGestorAplicacoes(
  req: Request,
): Promise<{ ok: true; gestor: GestorAplicacoes } | { ok: false; status: 401 | 403; erro: string }> {
  const payload = await autenticarRequisicao(req);
  if (!payload) return { ok: false, status: 401, erro: "Não autenticado." };
  if (!(await ehAplicacaoPadrao(payload.aplicacaoId))) {
    return { ok: false, status: 403, erro: "Acesso restrito a contas do painel do provedor." };
  }
  if (payload.papel === "admin") {
    return { ok: true, gestor: { payload, operador: true, organizacaoDonaId: null } };
  }
  if (payload.papelOrganizacao !== "dono" && payload.papelOrganizacao !== "admin") {
    return { ok: false, status: 403, erro: "Só dono ou admin da organização gerencia aplicações." };
  }
  const usuario = await prisma.usuario.findUnique({
    where: { id: payload.sub },
    select: { emailVerificado: true },
  });
  if (!usuario?.emailVerificado) {
    return { ok: false, status: 403, erro: "Verifique seu e-mail antes de criar aplicações." };
  }
  return { ok: true, gestor: { payload, operador: false, organizacaoDonaId: payload.organizacaoId } };
}

/**
 * Filtro das aplicações que o gestor enxerga. Aplicação de outra organização
 * responde 404 (não 403) nas rotas por id: nem a existência dela vaza.
 */
export function escopoDoGestor(gestor: GestorAplicacoes) {
  return gestor.operador ? {} : { organizacaoDonaId: gestor.organizacaoDonaId };
}

export async function ehAplicacaoPadrao(aplicacaoId: string | undefined): Promise<boolean> {
  if (!aplicacaoId) return false;
  const padrao = await prisma.aplicacao.findFirst({
    where: { id: aplicacaoId, padrao: true },
    select: { id: true },
  });
  return !!padrao;
}

// clientId é PÚBLICO (vai no JavaScript do cliente, no header
// x-aplicacao-id) — o prefixo só ajuda a reconhecê-lo num log. Mesmo formato
// do scripts/backfill-aplicacoes.mjs.
export function gerarClientId(): string {
  return `app_${randomBytes(16).toString("hex")}`;
}

// clientSecret é credencial: 32 bytes aleatórios, mostrado UMA vez na
// criação/rotação e guardado só como hash. SHA-256 (e não bcrypt) pelo mesmo
// motivo do hash do refresh token: com 256 bits de entropia não existe
// dicionário pra atacar, e o custo lento do bcrypt só serve pra segredo
// escolhido por gente.
export function gerarClientSecret(): { segredo: string; hash: string } {
  const segredo = `sec_${randomBytes(32).toString("base64url")}`;
  return { segredo, hash: hashToken(segredo) };
}

// Regra do WebAuthn: o RP ID precisa ser o host da origem ou um sufixo de
// domínio registrável dele ("exemplo.com" serve pra "https://app.exemplo.com",
// nunca pra "https://exemplo.com.br"). Uma combinação que não obedece isso é
// uma aplicação em que NENHUMA passkey registra — melhor recusar no cadastro
// do que deixar o cliente descobrir no primeiro usuário.
export function origensIncompativeisComRpId(origens: string[], rpId: string): string[] {
  return origens.filter((origem) => {
    const host = new URL(origem).hostname;
    return host !== rpId && !host.endsWith(`.${rpId}`);
  });
}

export const SELECAO_APLICACAO_PUBLICA = {
  id: true,
  nome: true,
  clientId: true,
  origens: true,
  passkeyRpId: true,
  emailRemetente: true,
  urlLinks: true,
  logoUrl: true,
  ativa: true,
  padrao: true,
  aprovada: true,
  desativadaPeloOperador: true,
  criadoEm: true,
  atualizadoEm: true,
  clientSecretHash: true,
  _count: { select: { usuarios: true } },
} as const;

// Valor de LogAuditoria.alvo nos eventos de gestão de aplicações: o clientId
// é o identificador estável; o nome vai junto pra trilha ser legível sem
// cruzar com outra tabela (e continua lá mesmo que a aplicação mude de nome).
export function alvoAplicacao(aplicacao: { clientId: string; nome: string }): string {
  return `aplicacao:${aplicacao.clientId} (${aplicacao.nome})`;
}

type AplicacaoComContagem = {
  clientSecretHash: string | null;
  _count: { usuarios: number };
} & Record<string, unknown>;

// Nunca devolve o hash do segredo, só se existe um — o hash não serve pra
// nada no painel e é material de ataque offline se vazar.
export function formatarAplicacao<T extends AplicacaoComContagem>(aplicacao: T) {
  const { clientSecretHash, _count, ...resto } = aplicacao;
  return { ...resto, temSegredo: clientSecretHash !== null, totalUsuarios: _count.usuarios };
}
