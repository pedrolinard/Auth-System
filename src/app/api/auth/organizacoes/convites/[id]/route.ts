import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { temPapelOrganizacao } from "@/lib/rbacOrganizacao";

// Cancela um convite pendente da organização ativa — o link já mandado por
// e-mail para de funcionar (aceitar-convite relê aceitoEm/exclusão a cada
// tentativa, então basta apagar a linha).
export async function DELETE(
  req: Request,
  { params }: RouteContext<"/api/auth/organizacoes/convites/[id]">,
) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

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

  const { id } = await params;
  const convite = await prisma.conviteOrganizacao.findUnique({ where: { id } });
  if (!convite || convite.organizacaoId !== payload.organizacaoId) {
    return NextResponse.json({ erro: "Convite não encontrado." }, { status: 404 });
  }

  await prisma.conviteOrganizacao.delete({ where: { id } });

  await registrarEvento({
    req,
    evento: "convite_organizacao_cancelado",
    usuarioId: payload.sub,
    email: convite.email,
  });

  return NextResponse.json({ sucesso: true });
}
