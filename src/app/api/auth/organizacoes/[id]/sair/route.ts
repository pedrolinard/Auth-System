import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { temOutraOrganizacaoAcessivel } from "@/lib/rbacOrganizacao";
import { revogacao } from "@/lib/revogacao";
import { criarSessao } from "@/lib/sessao";
import { dadosDoUsuario, emitirEventoWebhook } from "@/lib/webhooks";

// A própria pessoa sai de uma organização. Quem está suspenso também pode
// sair — sair não dá acesso a nada, só desfaz o vínculo.
export async function POST(
  req: Request,
  { params }: RouteContext<"/api/auth/organizacoes/[id]/sair">,
) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const { id } = await params;
  const membro = await prisma.membro.findUnique({
    where: { organizacaoId_usuarioId: { organizacaoId: id, usuarioId: payload.sub } },
  });
  if (!membro) {
    return NextResponse.json({ erro: "Organização não encontrada." }, { status: 404 });
  }

  // Mesma regra da remoção por admin e da exclusão de conta: a organização
  // não pode ficar sem dono. Se não sobra ninguém, sair só deixaria uma
  // organização órfã — o caminho certo é excluí-la.
  if (membro.papel === "dono") {
    const [outrosDonos, outrosMembros] = await Promise.all([
      prisma.membro.count({
        where: { organizacaoId: id, papel: "dono", usuarioId: { not: payload.sub } },
      }),
      prisma.membro.count({ where: { organizacaoId: id, usuarioId: { not: payload.sub } } }),
    ]);
    if (outrosMembros === 0) {
      return NextResponse.json(
        { erro: "Você é a única pessoa nesta organização. Exclua a organização em vez de sair." },
        { status: 409 },
      );
    }
    if (outrosDonos === 0) {
      return NextResponse.json(
        { erro: "Você é o único dono. Transfira a organização para outra pessoa antes de sair." },
        { status: 409 },
      );
    }
  }

  if (!(await temOutraOrganizacaoAcessivel(payload.sub, id))) {
    return NextResponse.json(
      { erro: "Esta é sua única organização. Crie ou entre em outra antes de sair desta." },
      { status: 409 },
    );
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });
  if (!usuario) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  await prisma.membro.delete({ where: { id: membro.id } });
  // Inclui a sessão atual, se ela estiver nesta organização — é reemitida
  // logo abaixo numa das que sobraram.
  await prisma.tokenAtualizacao.updateMany({
    where: { usuarioId: usuario.id, organizacaoId: id, revogadoEm: null },
    data: revogacao("saida_organizacao"),
  });

  await registrarEvento({
    req,
    evento: "membro_saiu_da_organizacao",
    usuarioId: usuario.id,
    email: usuario.email,
  });
  await emitirEventoWebhook(usuario.aplicacaoId, "membro.saiu", {
    ...dadosDoUsuario(usuario),
    organizacaoId: id,
  });

  if (payload.organizacaoId === id) {
    const sessao = await criarSessao(usuario, req);
    return NextResponse.json({ sucesso: true, ...sessao });
  }
  return NextResponse.json({ sucesso: true });
}
