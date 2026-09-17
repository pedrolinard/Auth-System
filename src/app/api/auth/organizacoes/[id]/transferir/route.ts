import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { conferirSenhaAtual } from "@/lib/senhaAtual";
import { criarSessao } from "@/lib/sessao";
import { estaSuspenso } from "@/lib/suspensao";
import { esquemaTransferirOrganizacao } from "@/lib/validacao";

// Transfere a titularidade: o alvo vira dono e quem transfere passa a admin
// (continua na organização, sem o poder de excluí-la nem de rebaixar o novo
// dono). Exige a senha atual — é o fluxo com "confirmação explícita de quem
// está saindo do posto" que esquemaCriarConvite adiou.
export async function POST(
  req: Request,
  { params }: RouteContext<"/api/auth/organizacoes/[id]/transferir">,
) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaTransferirOrganizacao.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const { id } = await params;
  const { usuarioId: alvoId, senha } = dadosValidados.data;

  // Papel lido do banco, não do token — ver o comentário em ../route.ts.
  const membroAtor = await prisma.membro.findUnique({
    where: { organizacaoId_usuarioId: { organizacaoId: id, usuarioId: payload.sub } },
  });
  if (!membroAtor) {
    return NextResponse.json({ erro: "Organização não encontrada." }, { status: 404 });
  }
  if (membroAtor.papel !== "dono") {
    return NextResponse.json(
      { erro: "Só um dono pode transferir a organização." },
      { status: 403 },
    );
  }
  if (alvoId === payload.sub) {
    return NextResponse.json(
      { erro: "Escolha outra pessoa para receber a organização." },
      { status: 400 },
    );
  }

  const membroAlvo = await prisma.membro.findUnique({
    where: { organizacaoId_usuarioId: { organizacaoId: id, usuarioId: alvoId } },
    include: { usuario: { select: { email: true } } },
  });
  if (!membroAlvo) {
    return NextResponse.json(
      { erro: "Usuário não encontrado nesta organização." },
      { status: 404 },
    );
  }
  // Passar a organização pra quem não consegue entrar nela a deixaria, na
  // prática, sem dono ativo.
  if (estaSuspenso(membroAlvo)) {
    return NextResponse.json(
      { erro: "Não é possível transferir a organização para alguém suspenso nela." },
      { status: 409 },
    );
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });
  if (!usuario) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const erroSenha = await conferirSenhaAtual(req, usuario, senha);
  if (erroSenha) return erroSenha;

  // O `papel: "dono"` no where do ator torna a transferência atômica: duas
  // transferências simultâneas do mesmo dono não promovem duas pessoas.
  const transferiu = await prisma.$transaction(async (tx) => {
    const { count } = await tx.membro.updateMany({
      where: { id: membroAtor.id, papel: "dono" },
      data: { papel: "admin" },
    });
    if (count !== 1) return false;
    await tx.membro.update({ where: { id: membroAlvo.id }, data: { papel: "dono" } });
    return true;
  });
  if (!transferiu) {
    return NextResponse.json(
      { erro: "Você não é mais dono desta organização." },
      { status: 409 },
    );
  }

  await registrarEvento({
    req,
    evento: "organizacao_transferida",
    usuarioId: alvoId,
    email: membroAlvo.usuario.email,
    autorId: usuario.id,
    autorEmail: usuario.email,
  });

  // O access token atual ainda diz "dono". Reemite já com o papel novo, pra
  // o próprio painel parar de oferecer ações de dono agora, não daqui a
  // até 15 min.
  if (payload.organizacaoId === id) {
    const sessao = await criarSessao(usuario, req, id);
    return NextResponse.json({ sucesso: true, ...sessao });
  }
  return NextResponse.json({ sucesso: true });
}
