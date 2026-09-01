import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { obterMembroDaOrganizacao, temPapelOrganizacao } from "@/lib/rbacOrganizacao";
import { esquemaSuspensao } from "@/lib/validacao";

// Quem pode suspender é escopado por organização (dono/admin da org ativa),
// mas suspenso/suspensoAte/suspensoMotivo continuam campos GLOBAIS do
// Usuario — suspender aqui bloqueia login em QUALQUER organização de que a
// pessoa participe, não só nesta. Trade-off aceito por enquanto: mover
// suspensão pra dentro de Membro é escopo maior (schema novo, refazer
// estaSuspenso() e todos os pontos de login), não crítico o bastante pra
// bloquear o multi-tenant por causa disso — documentado em
// ROADMAP.md ("O que falta") e src/data/roadmap.ts.
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
  if (!(await obterMembroDaOrganizacao(payload.organizacaoId, id))) {
    return NextResponse.json(
      { erro: "Usuário não encontrado nesta organização." },
      { status: 404 },
    );
  }

  const usuario = await prisma.usuario.findUnique({ where: { id } });
  if (!usuario) {
    return NextResponse.json({ erro: "Usuário não encontrado." }, { status: 404 });
  }

  const { dias, motivo } = dadosValidados.data;
  const suspensoAte = dias ? new Date(Date.now() + dias * 24 * 60 * 60 * 1000) : null;

  await prisma.usuario.update({
    where: { id },
    data: {
      suspenso: true,
      suspensoAte,
      suspensoMotivo: motivo ?? null,
    },
  });

  // Derruba as sessões ativas na hora. O access token de até 15 min ainda
  // vale até expirar naturalmente — mesmo trade-off já aceito em "sair de
  // todos os dispositivos" (JWT stateless não dá pra revogar no meio do voo).
  await prisma.tokenAtualizacao.updateMany({
    where: { usuarioId: id, revogadoEm: null },
    data: { revogadoEm: new Date() },
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
