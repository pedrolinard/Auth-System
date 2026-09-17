import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { temOutraOrganizacaoAcessivel } from "@/lib/rbacOrganizacao";
import { conferirSenhaAtual } from "@/lib/senhaAtual";
import { criarSessao } from "@/lib/sessao";
import { esquemaExcluirOrganizacao, esquemaRenomearOrganizacao } from "@/lib/validacao";

// As duas rotas leem o papel do Membro no banco, não do token: o id vem na
// URL (não precisa ser a organização ativa), e o papel do token pode estar
// até 15 min defasado — o que num rebaixamento ou transferência recente
// deixaria um ex-dono excluir a organização.

// Renomeia a organização. O slug fica como está (ver
// esquemaRenomearOrganizacao).
export async function PATCH(
  req: Request,
  { params }: RouteContext<"/api/auth/organizacoes/[id]">,
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
  if (membro.papel !== "dono" && membro.papel !== "admin") {
    return NextResponse.json(
      { erro: "Acesso restrito a administradores da organização." },
      { status: 403 },
    );
  }

  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaRenomearOrganizacao.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const organizacao = await prisma.organizacao.update({
    where: { id },
    data: { nome: dadosValidados.data.nome },
    select: { id: true, nome: true, slug: true },
  });

  await registrarEvento({
    req,
    evento: "organizacao_renomeada",
    usuarioId: payload.sub,
    email: payload.email,
  });

  return NextResponse.json({ organizacao });
}

// Exclui a organização inteira — só dono, com a senha atual. Membro,
// convites e sessões presas a ela caem em cascata (schema): quem estava
// usando esta organização em outro dispositivo perde a sessão na próxima
// renovação e, ao entrar de novo, cai em outra organização (ou ganha uma
// pessoal, se não tiver nenhuma — ver resolverOrganizacaoAtiva).
//
// Projetos e tarefas no Django (schema dominio, sem FK entre os serviços)
// ficam órfãos — mesma pendência da exclusão de conta, ver o item
// "exclusao-dados-dominio" do roadmap.
export async function DELETE(
  req: Request,
  { params }: RouteContext<"/api/auth/organizacoes/[id]">,
) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaExcluirOrganizacao.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const { id } = await params;
  const membro = await prisma.membro.findUnique({
    where: { organizacaoId_usuarioId: { organizacaoId: id, usuarioId: payload.sub } },
  });
  if (!membro) {
    return NextResponse.json({ erro: "Organização não encontrada." }, { status: 404 });
  }
  if (membro.papel !== "dono") {
    return NextResponse.json(
      { erro: "Só um dono pode excluir a organização." },
      { status: 403 },
    );
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });
  if (!usuario) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  // Antes da senha: não faz sentido gastar uma tentativa numa exclusão que
  // seria recusada de qualquer jeito.
  if (!(await temOutraOrganizacaoAcessivel(usuario.id, id))) {
    return NextResponse.json(
      {
        erro:
          "Esta é sua única organização. Crie ou entre em outra antes de excluir esta — ou exclua a sua conta.",
      },
      { status: 409 },
    );
  }

  const erroSenha = await conferirSenhaAtual(req, usuario, dadosValidados.data.senha);
  if (erroSenha) return erroSenha;

  const { count } = await prisma.organizacao.deleteMany({ where: { id } });
  if (count === 0) {
    // Outro dono excluiu no meio-tempo.
    return NextResponse.json({ erro: "Organização não encontrada." }, { status: 404 });
  }

  await registrarEvento({
    req,
    evento: "organizacao_excluida",
    usuarioId: usuario.id,
    email: usuario.email,
  });

  // A sessão atual estava nesta organização e acabou de sumir junto com
  // ela — reemite numa das que sobraram.
  if (payload.organizacaoId === id) {
    const sessao = await criarSessao(usuario, req);
    return NextResponse.json({ sucesso: true, ...sessao });
  }
  return NextResponse.json({ sucesso: true });
}
