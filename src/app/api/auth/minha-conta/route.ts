import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf, removerCookieAcesso, removerCookieAtualizacao, removerCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { classificarDispositivo } from "@/lib/dispositivo";
import { enviarEmailContaExcluida } from "@/lib/email";
import { formatarLocalizacao } from "@/lib/geo";
import { limiteExcedido, limiteExcedidoPorEmail, obterIp } from "@/lib/rateLimit";
import { verificarSenha } from "@/lib/senha";
import { esquemaExcluirConta } from "@/lib/validacao";

// Autoatendimento LGPD: até aqui só um admin conseguia excluir a conta de
// outra pessoa (DELETE /api/auth/usuarios/[id]) — o próprio titular não tinha
// como exportar nem apagar os próprios dados sem pedir pra um admin.

// GET exporta só o que este serviço (auth-gateway) guarda sobre o titular —
// não inclui Projeto/Tarefa do serviço de domínio (django/), que é uma base
// de dados separada sem FK real com o usuário (só o claim `sub` do JWT como
// referência opaca); juntar os dois exigiria o Next.js chamar o Django
// internamente carregando as credenciais da requisição, escopo maior que o
// deste item do roadmap.
export async function GET(req: Request) {
  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });
  if (!usuario) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const [sessoes, dispositivosConfiaveis, codigosBackup, logsAuditoria] = await Promise.all([
    prisma.tokenAtualizacao.findMany({
      where: { usuarioId: usuario.id },
      orderBy: { criadoEm: "desc" },
      select: {
        criadoEm: true,
        expiraEm: true,
        revogadoEm: true,
        userAgent: true,
        geoCidade: true,
        geoRegiao: true,
        geoPais: true,
      },
    }),
    prisma.dispositivoConfiavel.findMany({
      where: { usuarioId: usuario.id },
      orderBy: { criadoEm: "desc" },
      select: { criadoEm: true, expiraEm: true },
    }),
    prisma.codigoBackupMfa.findMany({
      where: { usuarioId: usuario.id },
      orderBy: { criadoEm: "desc" },
      select: { criadoEm: true, usadoEm: true },
    }),
    prisma.logAuditoria.findMany({
      where: { usuarioId: usuario.id },
      orderBy: { criadoEm: "desc" },
      take: 500,
      select: { evento: true, ip: true, userAgent: true, criadoEm: true },
    }),
  ]);

  return NextResponse.json({
    exportadoEm: new Date().toISOString(),
    dadosPessoais: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      emailVerificado: usuario.emailVerificado,
      papel: usuario.papel,
      mfaAtivado: usuario.mfaAtivado,
      criadoEm: usuario.criadoEm,
      atualizadoEm: usuario.atualizadoEm,
    },
    // tokenHash nunca sai daqui — mesmo com hash (não o token em si), é
    // material de posse de sessão e não faz sentido num export de dados.
    sessoes: sessoes.map(({ userAgent, geoCidade, geoRegiao, geoPais, ...resto }) => ({
      ...resto,
      tipoDispositivo: classificarDispositivo(userAgent),
      localizacao: formatarLocalizacao({ cidade: geoCidade, regiao: geoRegiao, pais: geoPais }),
    })),
    dispositivosConfiaveis,
    codigosBackupMfa: codigosBackup,
    logsAuditoria,
  });
}

const MAX_TENTATIVAS_SENHA_ATUAL = 5;
const JANELA_SENHA_ATUAL_MS = 5 * 60 * 1000;

// DELETE exclui a conta permanentemente (cascata: sessões, dispositivos
// confiáveis, códigos de backup — ver onDelete: Cascade no schema).
// LogAuditoria não tem FK de propósito, então o histórico de auditoria
// sobrevive, como já acontece na exclusão feita por um admin.
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
      janelaMs: JANELA_SENHA_ATUAL_MS,
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

  if (
    await limiteExcedidoPorEmail({
      email: usuario.email,
      evento: "senha_atual_falha",
      maximo: MAX_TENTATIVAS_SENHA_ATUAL,
      janelaMs: JANELA_SENHA_ATUAL_MS,
    })
  ) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }

  if (!(await verificarSenha(dadosValidados.data.senha, usuario.senhaHash))) {
    await registrarEvento({
      req,
      evento: "senha_atual_falha",
      usuarioId: usuario.id,
      email: usuario.email,
    });
    return NextResponse.json({ erro: "Senha incorreta." }, { status: 401 });
  }

  await prisma.usuario.delete({ where: { id: usuario.id } });
  await registrarEvento({
    req,
    evento: "conta_excluida_pelo_titular",
    usuarioId: usuario.id,
    email: usuario.email,
  });
  await enviarEmailContaExcluida(usuario.email);

  await removerCookieAtualizacao();
  await removerCookieAcesso();
  await removerCookieCsrf();

  return NextResponse.json({ sucesso: true });
}
