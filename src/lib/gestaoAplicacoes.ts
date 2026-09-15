import "server-only";

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { autenticarRequisicao } from "@/lib/autenticar";
import { hashToken, type PayloadTokenAcesso } from "@/lib/token";

// Gestão de aplicações (Fase 01 do provedor): criar, editar, desativar e
// rotacionar o segredo dos clientes que integram com este provedor.

// Quem opera o provedor: admin de SISTEMA cuja conta vive na aplicação
// padrão (o próprio painel deste projeto). As duas condições são
// necessárias. Só `papel === "admin"` não basta: quando um cliente tiver
// usuários finais com papel de admin de sistema DENTRO da aplicação dele,
// esse admin não pode enxergar nem editar as aplicações dos outros clientes —
// seria o equivalente, um nível acima, ao vazamento que o escopo da
// auditoria por aplicação já fecha.
export async function autenticarOperadorProvedor(
  req: Request,
): Promise<
  | { ok: true; payload: PayloadTokenAcesso }
  | { ok: false; status: 401 | 403; erro: string }
> {
  const payload = await autenticarRequisicao(req);
  if (!payload) return { ok: false, status: 401, erro: "Não autenticado." };
  if (payload.papel !== "admin" || !(await ehAplicacaoPadrao(payload.aplicacaoId))) {
    return { ok: false, status: 403, erro: "Acesso restrito a quem opera o provedor." };
  }
  return { ok: true, payload };
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
