import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { obterMembroDaOrganizacao, podeAgirSobre, temPapelOrganizacao } from "@/lib/rbacOrganizacao";
import { revogacao } from "@/lib/revogacao";
import { esquemaSuspensao } from "@/lib/validacao";

// Suspende a pessoa DENTRO da organização ativa de quem está agindo — o
// efeito fica em Membro, não em Usuario. Ela continua entrando nas outras
// organizações de que participa (inclusive a pessoal): um dono/admin da
// organização A não tem autoridade sobre o que ela faz na organização B.
export async function POST(
  req: Request,
  { params }: RouteContext<"/api/auth/usuarios/[id]/suspender">,
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
      { erro: "Não é possível suspender a própria conta." },
      { status: 400 },
    );
  }

  const corpo = await req.json().catch(() => ({}));
  const dadosValidados = esquemaSuspensao.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  // Alvo precisa ser membro da MESMA organização de quem está agindo — sem
  // isso, um admin da organização A suspenderia qualquer conta do sistema
  // só sabendo o id.
  const membro = await obterMembroDaOrganizacao(payload.organizacaoId, id);
  if (!membro) {
    return NextResponse.json(
      { erro: "Usuário não encontrado nesta organização." },
      { status: 404 },
    );
  }
  if (!podeAgirSobre(payload.papelOrganizacao, membro.papel)) {
    return NextResponse.json(
      { erro: "Só um dono pode suspender outro dono." },
      { status: 403 },
    );
  }

  const usuario = await prisma.usuario.findUnique({ where: { id } });
  if (!usuario) {
    return NextResponse.json({ erro: "Usuário não encontrado." }, { status: 404 });
  }

  const { dias, motivo } = dadosValidados.data;
  const suspensoAte = dias ? new Date(Date.now() + dias * 24 * 60 * 60 * 1000) : null;

  await prisma.membro.update({
    where: { id: membro.id },
    data: {
      suspenso: true,
      suspensoAte,
      suspensoMotivo: motivo ?? null,
    },
  });

  // Derruba na hora as sessões DESTA organização — as das outras seguem
  // vivas, pelo mesmo motivo de a suspensão ser por organização. Sessão sem
  // organizacaoId (emitida antes da coluna existir) cai junto: não dá pra
  // saber a que organização ela pertence, e /atualizar a resolveria de novo.
  // O access token de até 15 min ainda vale até expirar naturalmente — mesmo
  // trade-off já aceito em "sair de todos os dispositivos" (JWT stateless não
  // dá pra revogar no meio do voo).
  await prisma.tokenAtualizacao.updateMany({
    where: {
      usuarioId: id,
      revogadoEm: null,
      OR: [{ organizacaoId: payload.organizacaoId }, { organizacaoId: null }],
    },
    data: revogacao("suspensao"),
  });

  await registrarEvento({
    req,
    evento: "usuario_suspenso_por_admin",
    usuarioId: id,
    email: usuario.email,
    autorId: payload.sub,
    autorEmail: payload.email,
  });

  return NextResponse.json({ sucesso: true });
}
