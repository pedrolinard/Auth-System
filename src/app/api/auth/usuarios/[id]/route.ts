import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { obterMembroDaOrganizacao, temPapelOrganizacao } from "@/lib/rbacOrganizacao";

// Remove o alvo da organização ativa — NÃO exclui a conta (Usuario) dele.
// Antes do multi-tenant esta rota excluía a conta inteira; virou remoção de
// vínculo porque um usuário pode pertencer a VÁRIAS organizações, e um admin
// de uma delas não deveria conseguir apagar a presença dele nas outras.
// Exclusão de conta de verdade (LGPD) continua existindo só como
// autoatendimento — DELETE /api/auth/minha-conta, o próprio titular.
export async function DELETE(
  req: Request,
  { params }: RouteContext<"/api/auth/usuarios/[id]">,
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
  if (id === payload.sub) {
    return NextResponse.json(
      { erro: "Não é possível remover a si mesmo da organização." },
      { status: 400 },
    );
  }

  const membro = await obterMembroDaOrganizacao(payload.organizacaoId, id);
  if (!membro) {
    return NextResponse.json(
      { erro: "Usuário não encontrado nesta organização." },
      { status: 404 },
    );
  }

  // Sem isso, a organização podia ficar sem nenhum dono — ninguém mais
  // conseguiria gerenciar membros nem transferir a titularidade.
  if (membro.papel === "dono") {
    const outrosDonos = await prisma.membro.count({
      where: { organizacaoId: payload.organizacaoId, papel: "dono", usuarioId: { not: id } },
    });
    if (outrosDonos === 0) {
      return NextResponse.json(
        { erro: "Não é possível remover o único dono da organização." },
        { status: 400 },
      );
    }
  }

  const usuario = await prisma.usuario.findUnique({ where: { id }, select: { email: true } });

  await prisma.membro.delete({ where: { id: membro.id } });

  // Derruba as sessões que essa pessoa tinha NESSA organização — o access
  // token de até 15 min ainda vale até expirar naturalmente (mesmo
  // trade-off de "sair de todos os dispositivos"), mas o refresh já falha na
  // próxima tentativa (atualizar/route.ts relê o Membro a cada renovação).
  await prisma.tokenAtualizacao.updateMany({
    where: { usuarioId: id, organizacaoId: payload.organizacaoId, revogadoEm: null },
    data: { revogadoEm: new Date() },
  });

  await registrarEvento({
    req,
    evento: "membro_removido_da_organizacao",
    usuarioId: id,
    email: usuario?.email,
    autorId: payload.sub,
    autorEmail: payload.email,
  });

  return NextResponse.json({ sucesso: true });
}
