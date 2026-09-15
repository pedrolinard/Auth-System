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
      suspenso: true,
      suspensoAte: true,
      suspensoMotivo: true,
      usuario: { select: { id: true, nome: true, email: true, criadoEm: true } },
    },
    orderBy: { criadoEm: "asc" },
  });

  // suspensoAtivo já vem calculado (suspensão temporária expirada = false)
  // pra o cliente não precisar refazer essa conta com o relógio local. A
  // suspensão é a DESTA organização (Membro) — se a pessoa estiver suspensa
  // em outra, isso não aparece aqui, e nem deveria.
  const usuarios = membros.map(({ papel, suspenso, suspensoAte, suspensoMotivo, usuario }) => ({
    ...usuario,
    papel,
    suspenso,
    suspensoAte,
    suspensoMotivo,
    suspensoAtivo: estaSuspenso({ suspenso, suspensoAte }),
  }));

  return NextResponse.json({ usuarios });
}
