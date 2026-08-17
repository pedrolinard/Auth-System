import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autenticarRequisicao } from "@/lib/autenticar";

const MAX_REGISTROS = 200;

// Lista os logs de auditoria mais recentes — acessível apenas para admins.
// LogAuditoria já existia (login/cadastro/logout, etc.); esta rota só
// expõe o que já é gravado, sem precisar acessar o banco direto.
export async function GET(req: Request) {
  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }
  if (payload.papel !== "admin") {
    return NextResponse.json(
      { erro: "Acesso restrito a administradores." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(req.url);
  const evento = searchParams.get("evento")?.trim() || undefined;
  const email = searchParams.get("email")?.trim().toLowerCase() || undefined;

  const registros = await prisma.logAuditoria.findMany({
    where: {
      ...(evento ? { evento } : {}),
      ...(email ? { email: { contains: email } } : {}),
    },
    orderBy: { criadoEm: "desc" },
    take: MAX_REGISTROS,
  });

  return NextResponse.json({ registros });
}
