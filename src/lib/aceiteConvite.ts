import "server-only";

import { NextResponse } from "next/server";

import { Prisma, type ConviteOrganizacao, type Usuario } from "@/generated/prisma/client";
import { registrarEvento } from "@/lib/auditoria";
import { prisma } from "@/lib/db";
import { criarSessao } from "@/lib/sessao";
import { estaSuspenso, mensagemSuspensaoOrganizacao } from "@/lib/suspensao";

// Mesma validade do link mandado por e-mail (DURACAO_TOKEN_CONVITE_ORGANIZACAO
// em token.ts): aceitar pelo painel não pode durar mais que aceitar pelo link.
export const VALIDADE_CONVITE_MS = 7 * 24 * 60 * 60 * 1000;

export function conviteVencido(convite: { criadoEm: Date }): boolean {
  return convite.criadoEm.getTime() + VALIDADE_CONVITE_MS < Date.now();
}

/**
 * Parte comum dos dois jeitos de aceitar um convite: pelo link do e-mail
 * (aceitar-convite, que prova a posse do e-mail com o token) e pelo painel
 * (convites-recebidos, que prova com o e-mail VERIFICADO da conta logada).
 * Quem chama já conferiu que o convite é desta conta e está pendente.
 */
export async function efetivarAceiteConvite(
  req: Request,
  usuario: Usuario,
  convite: ConviteOrganizacao,
): Promise<NextResponse> {
  // O e-mail só é único DENTRO de uma aplicação. Sem esta checagem, a mesma
  // pessoa com conta em duas aplicações (dois clientes diferentes do
  // provedor) aceitaria, logada na conta do cliente B, o convite de uma
  // organização do cliente A — e viraria membro de um tenant que não é o
  // dela, com um token emitido para a aplicação B apontando pra organização
  // de A. Mesma resposta de e-mail errado: a conta certa é outra.
  const organizacaoDoConvite = await prisma.organizacao.findUnique({
    where: { id: convite.organizacaoId },
    select: { aplicacaoId: true },
  });
  if (!organizacaoDoConvite || organizacaoDoConvite.aplicacaoId !== usuario.aplicacaoId) {
    return NextResponse.json(
      { erro: "Este convite foi enviado para outro e-mail. Entre com a conta certa antes de aceitar." },
      { status: 403 },
    );
  }

  const jaEhMembro = await prisma.membro.findUnique({
    where: {
      organizacaoId_usuarioId: { organizacaoId: convite.organizacaoId, usuarioId: usuario.id },
    },
  });
  // Já é membro, mas suspenso nesta organização: aceitar um convite não
  // pode virar atalho pra furar a suspensão (e criarSessao recusaria entrar
  // nela, respondendo 500).
  if (jaEhMembro && estaSuspenso(jaEhMembro)) {
    return NextResponse.json(
      { erro: mensagemSuspensaoOrganizacao(jaEhMembro) },
      { status: 403 },
    );
  }

  if (!jaEhMembro) {
    try {
      await prisma.$transaction([
        prisma.membro.create({
          data: { organizacaoId: convite.organizacaoId, usuarioId: usuario.id, papel: convite.papel },
        }),
        prisma.conviteOrganizacao.update({
          where: { id: convite.id },
          data: { aceitoEm: new Date() },
        }),
      ]);
      await registrarEvento({
        req,
        evento: "convite_organizacao_aceito",
        usuarioId: usuario.id,
        email: usuario.email,
      });
    } catch (erro) {
      // Duas abas/cliques aceitando o MESMO convite ao mesmo tempo: as duas
      // passam pela checagem de jaEhMembro antes de qualquer uma escrever, a
      // segunda esbarra na constraint única de Membro. Não é erro de
      // verdade — a pessoa já entrou na organização pela outra requisição —
      // só segue pra emitir a sessão normalmente em vez de estourar 500.
      const jaMembroPorCorrida =
        erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002";
      if (!jaMembroPorCorrida) throw erro;
    }
  } else if (!convite.aceitoEm) {
    // Já era membro (ex.: dois convites concorrentes) — só fecha o convite
    // como aceito, idempotente, sem tentar criar o Membro de novo.
    await prisma.conviteOrganizacao.update({
      where: { id: convite.id },
      data: { aceitoEm: new Date() },
    });
  }

  // Entra direto na organização recém-aceita, mesma UX de criar organização.
  const sessao = await criarSessao(usuario, req, convite.organizacaoId);
  return NextResponse.json(sessao);
}
