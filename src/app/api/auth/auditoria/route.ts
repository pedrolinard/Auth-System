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
      // Escopo obrigatório: um admin de sistema continua vendo a trilha
      // inteira DA APLICAÇÃO DELE, e nunca a de outro cliente. Sem esta
      // linha, o painel de auditoria de um provedor mostra os e-mails, IPs e
      // horários de login dos usuários finais de todos os clientes pra
      // qualquer admin — que não é uma folga de permissão, é vazamento de
      // dado pessoal de terceiro.
      aplicacaoId: payload.aplicacaoId,
      ...(evento ? { evento } : {}),
      ...(email ? { email: { contains: email } } : {}),
    },
    orderBy: { criadoEm: "desc" },
    take: MAX_REGISTROS,
  });

  return NextResponse.json({ registros });
}
