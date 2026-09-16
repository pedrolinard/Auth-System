import "server-only";

import { prisma } from "@/lib/db";
import { VALIDADE_CONVITE_MS } from "@/lib/aceiteConvite";

// Convites que chegaram para o e-mail da conta logada, pra ela ver e responder
// no painel sem depender do link do e-mail.
//
// Só com o e-mail VERIFICADO. O link do e-mail prova que a pessoa lê aquela
// caixa; aqui a prova é a verificação. Sem ela, qualquer um cadastraria uma
// conta com o e-mail de outra pessoa (a conta nasce não verificada) e entraria
// nas organizações que convidaram essa pessoa.
//
// Só da mesma aplicação: o e-mail é único por aplicação, não no sistema.

type UsuarioDoConvite = { id: string; email: string; aplicacaoId: string };

function condicoesDoDestinatario(usuario: UsuarioDoConvite) {
  return {
    email: { equals: usuario.email, mode: "insensitive" as const },
    aceitoEm: null,
    criadoEm: { gte: new Date(Date.now() - VALIDADE_CONVITE_MS) },
    organizacao: {
      aplicacaoId: usuario.aplicacaoId,
      // Já é membro (entrou por outro convite, por exemplo): nada a responder.
      membros: { none: { usuarioId: usuario.id } },
    },
  };
}

export function listarConvitesRecebidos(usuario: UsuarioDoConvite) {
  return prisma.conviteOrganizacao.findMany({
    where: condicoesDoDestinatario(usuario),
    orderBy: { criadoEm: "desc" },
    select: {
      id: true,
      papel: true,
      criadoEm: true,
      organizacao: { select: { nome: true } },
      criadoPor: { select: { nome: true } },
    },
  });
}

/** O convite, se ele for desta conta e ainda puder ser respondido. */
export function buscarConviteRecebido(usuario: UsuarioDoConvite, id: string) {
  return prisma.conviteOrganizacao.findFirst({ where: { id, ...condicoesDoDestinatario(usuario) } });
}
