import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { contextoEmail } from "@/lib/aplicacao";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf, removerCookieAcesso, removerCookieAtualizacao, removerCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { enviarEmailContaExcluida } from "@/lib/email";
import { agendarExclusaoDominio, alvosDaExclusao, processarExclusoesDominio } from "@/lib/exclusaoDominio";
import { dadosDoUsuario, emitirEventoWebhook } from "@/lib/webhooks";
import { limiteExcedido, obterIp } from "@/lib/rateLimit";
import { conferirSenhaAtual } from "@/lib/senhaAtual";
import { esquemaExcluirConta } from "@/lib/validacao";
import { anonimizarRastrosDaConta } from "@/lib/anonimizacao";

// Autoatendimento LGPD: o titular exclui a própria conta aqui (DELETE) e
// exporta os próprios dados em POST /api/auth/minha-conta/exportar (rota
// separada porque o export passou a exigir a senha atual).

const MAX_TENTATIVAS_SENHA_ATUAL = 5;

// DELETE exclui a conta permanentemente (cascata: sessões, dispositivos
// confiáveis, códigos de backup, Membro — ver onDelete: Cascade no schema).
// LogAuditoria não tem FK de propósito, então o histórico de auditoria
// sobrevive, como já acontece na exclusão feita por um admin.
//
// Multi-tenant: Membro cascade-deleta, mas Organizacao NÃO cascade-deleta
// de Membro — sem tratar isso aqui, a organização pessoal (nome derivado do
// próprio nome da pessoa) sobreviveria órfã pra sempre, direito ao
// esquecimento incompleto. E se a pessoa for a única "dono" de uma
// organização com OUTROS membros, apagar a conta deixaria a organização sem
// ninguém pra gerenciá-la — mesmo risco que a remoção via admin já evita
// (ver DELETE /api/auth/usuarios/[id]), só que faltava aqui.
export async function DELETE(req: Request) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  // Mesma fricção de PUT /api/auth/senha: sem isso, um access token roubado
  // bastaria pra apagar a conta sem provar conhecer a senha, e sem limite de
  // tentativas um invasor com esse token poderia forçar bruta a senha atual
  // sem parar. Reaproveita o mesmo evento "senha_atual_falha" — o orçamento
  // de tentativas de senha atual é compartilhado entre os dois endpoints.
  const ip = obterIp(req);
  if (
    await limiteExcedido({
      ip,
      evento: "senha_atual_falha",
      maximo: MAX_TENTATIVAS_SENHA_ATUAL,
    })
  ) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }

  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaExcluirConta.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });
  if (!usuario) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const erroSenha = await conferirSenhaAtual(req, usuario, dadosValidados.data.senha);
  if (erroSenha) return erroSenha;

  const donatarios = await prisma.membro.findMany({
    where: { usuarioId: usuario.id, papel: "dono" },
    select: { organizacaoId: true },
  });

  const organizacoesParaExcluir: string[] = [];
  for (const { organizacaoId } of donatarios) {
    const outrosMembros = await prisma.membro.count({
      where: { organizacaoId, usuarioId: { not: usuario.id } },
    });
    if (outrosMembros === 0) {
      // Organização exclusiva dela (o caso comum: a organização pessoal
      // criada no cadastro) — vira órfã depois do cascade de Membro, então
      // some junto.
      organizacoesParaExcluir.push(organizacaoId);
      continue;
    }
    const outrosDonos = await prisma.membro.count({
      where: { organizacaoId, papel: "dono", usuarioId: { not: usuario.id } },
    });
    if (outrosDonos === 0) {
      return NextResponse.json(
        {
          erro:
            "Você é a única pessoa dona de uma organização com outros membros. Promova outro dono ou remova os demais membros antes de excluir sua conta.",
        },
        { status: 409 },
      );
    }
  }

  // Projetos e tarefas dessas organizações (e os legados da conta, sem
  // organização) vivem no Django: o pedido de exclusão entra na mesma
  // transação (ver exclusaoDominio.ts).
  const exclusaoDominio = { organizacoes: organizacoesParaExcluir, usuarioId: usuario.id };
  await prisma.$transaction([
    prisma.usuario.delete({ where: { id: usuario.id } }),
    ...(organizacoesParaExcluir.length > 0
      ? [prisma.organizacao.deleteMany({ where: { id: { in: organizacoesParaExcluir } } })]
      : []),
    agendarExclusaoDominio(prisma, exclusaoDominio),
    ...anonimizarRastrosDaConta(prisma, usuario),
  ]);
  // Depois da resposta: com o Django lento ou fora do ar, a pessoa não espera
  // o tempo limite pra ver a conta excluída. O que falhar fica na fila pro
  // job de limpeza.
  after(() => processarExclusoesDominio(alvosDaExclusao(exclusaoDominio)));
  await registrarEvento({
    req,
    evento: "conta_excluida_pelo_titular",
    // Só o id (que não aponta pra mais nada): sem e-mail, IP nem navegador.
    usuarioId: usuario.id,
    semRastro: true,
    // Explícito: a conta acabou de ser apagada, então o fallback de
    // registrarEvento (buscar a aplicação pelo usuarioId) não acharia nada e o
    // evento sairia sem escopo — sumindo da auditoria do cliente.
    aplicacaoId: usuario.aplicacaoId,
  });
  await enviarEmailContaExcluida(usuario.email, (await contextoEmail(usuario.aplicacaoId)).marca);
  // Só o id: a conta não existe mais, e o sistema do cliente só precisa saber
  // qual apagar do lado dele.
  await emitirEventoWebhook(usuario.aplicacaoId, "usuario.excluido", dadosDoUsuario({ id: usuario.id }));

  await removerCookieAtualizacao();
  await removerCookieAcesso();
  await removerCookieCsrf();

  return NextResponse.json({ sucesso: true });
}
