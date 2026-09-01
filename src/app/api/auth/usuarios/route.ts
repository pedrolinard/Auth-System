import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autenticarRequisicao } from "@/lib/autenticar";
import { temPapelOrganizacao } from "@/lib/rbacOrganizacao";
import { estaSuspenso } from "@/lib/suspensao";

// Lista os MEMBROS da organização ativa — acessível a quem tem papel "dono"
// ou "admin" NESSA organização. Antes do multi-tenant, listava todo mundo do
// sistema (Usuario.papel === "admin"); agora é escopado (ver
// src/lib/rbacOrganizacao.ts sobre a mudança).
export async function GET(req: Request) {
  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }
  if (!temPapelOrganizacao(payload.papelOrganizacao, ["dono", "admin"])) {
    return NextResponse.json(
      { erro: "Acesso restrito a administradores da organização." },
      { status: 403 },
    );
  }

  const membros = await prisma.membro.findMany({
    where: { organizacaoId: payload.organizacaoId },
    select: {
      papel: true,
      usuario: {
        select: {
          id: true,
          nome: true,
          email: true,
          criadoEm: true,
          suspenso: true,
          suspensoAte: true,
          suspensoMotivo: true,
        },
      },
    },
    orderBy: { criadoEm: "asc" },
  });

  // suspensoAtivo já vem calculado (suspensão temporária expirada = false)
  // pra o cliente não precisar refazer essa conta com o relógio local.
  // Suspensão continua sendo por CONTA (Usuario), não por organização — ver
  // nota em rbacOrganizacao.ts: suspender aqui afeta a conta em qualquer
  // organização de que o usuário participe, trade-off aceito por enquanto.
  const usuarios = membros.map(({ papel, usuario }) => ({
    ...usuario,
    papel,
    suspensoAtivo: estaSuspenso(usuario),
  }));

  return NextResponse.json({ usuarios });
}
