import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";

// LGPD: quando a pessoa exclui a própria conta, o que sobra dela em outras
// tabelas deixa de identificá-la. A trilha de auditoria continua existindo
// (o evento, a data, a aplicação e o id, que não aponta mais pra ninguém),
// porque serve pra investigar incidente e abuso; o que sai é o que liga o
// registro a uma pessoa: e-mail, IP e navegador.
//
// Três casos, porque IP e navegador são de QUEM AGIU:
//   - eventos da própria pessoa (ela é o alvo e ninguém mais agiu): tudo sai;
//   - eventos em que ela foi alvo de outra pessoa (um admin a suspendeu): sai
//     só o e-mail dela; IP e navegador são do admin e continuam;
//   - eventos em que ela agiu sobre outra conta: saem o e-mail de autora, o
//     IP e o navegador (que eram dela).
// Eventos sem usuarioId (falha de login com esse e-mail) casam pelo e-mail,
// dentro da mesma aplicação — contas são por aplicação.
//
// Entregas de webhook que carregam o e-mail dela somem também (duram 30 dias
// de qualquer forma; ver limpezaTokens.ts). O aviso usuario.excluido é criado
// depois, só com o id.
//
// Devolve as operações pra entrarem na MESMA transação da exclusão.
export function anonimizarRastrosDaConta(
  prisma: PrismaClient,
  usuario: { id: string; email: string; aplicacaoId: string },
) {
  const daPessoa = {
    aplicacaoId: usuario.aplicacaoId,
    OR: [{ usuarioId: usuario.id }, { email: usuario.email }],
  };
  return [
    prisma.logAuditoria.updateMany({
      where: { ...daPessoa, autorId: null },
      data: { email: null, ip: null, userAgent: null },
    }),
    prisma.logAuditoria.updateMany({
      where: { ...daPessoa, autorId: { not: null } },
      data: { email: null },
    }),
    prisma.logAuditoria.updateMany({
      where: { autorId: usuario.id },
      data: { autorEmail: null, ip: null, userAgent: null },
    }),
    prisma.entregaWebhook.deleteMany({
      where: { payload: { path: ["dados", "usuario", "id"], equals: usuario.id } },
    }),
  ];
}
