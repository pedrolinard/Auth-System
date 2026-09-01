import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { classificarDispositivo } from "@/lib/dispositivo";
import { formatarLocalizacao } from "@/lib/geo";
import {
  limiteExcedido,
  limiteExcedidoPorEmail,
  obterIp,
  registrarTentativaEmail,
  registrarTentativaIp,
} from "@/lib/rateLimit";
import { verificarSenha } from "@/lib/senha";
import { esquemaExcluirConta } from "@/lib/validacao";

// Export de dados pessoais (LGPD). Era um GET só com o cookie de acesso —
// mas o arquivo traz IP, geolocalização, user-agents e centenas de eventos
// de auditoria, então agora exige a senha atual (mesma fricção da exclusão
// de conta) + CSRF + rate limit. É POST em vez de GET porque carrega corpo
// (a senha) e não deve ser cacheado/pré-carregado.
const MAX_TENTATIVAS_SENHA_ATUAL = 5;
const JANELA_SENHA_ATUAL_MS = 5 * 60 * 1000;

export async function POST(req: Request) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

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

  if (
    await limiteExcedidoPorEmail({
      email: usuario.email,
      evento: "senha_atual_falha",
      maximo: MAX_TENTATIVAS_SENHA_ATUAL,
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
    await registrarTentativaIp({ ip, evento: "senha_atual_falha", janelaMs: JANELA_SENHA_ATUAL_MS });
    await registrarTentativaEmail({
      email: usuario.email,
      evento: "senha_atual_falha",
      janelaMs: JANELA_SENHA_ATUAL_MS,
    });
    return NextResponse.json({ erro: "Senha atual incorreta." }, { status: 401 });
  }

  const [sessoes, dispositivosConfiaveis, codigosBackup, passkeys, logsAuditoria, membros, convitesCriados] =
    await Promise.all([
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
      prisma.passkeyCredencial.findMany({
        where: { usuarioId: usuario.id },
        orderBy: { criadoEm: "desc" },
        select: { nome: true, transportes: true, criadoEm: true, ultimoUsoEm: true },
      }),
      prisma.logAuditoria.findMany({
        where: { usuarioId: usuario.id },
        orderBy: { criadoEm: "desc" },
        take: 500,
        select: { evento: true, ip: true, userAgent: true, criadoEm: true },
      }),
      // Multi-tenant: em quais organizações a pessoa é membro e com que
      // papel — sem isso o export ficava incompleto (dado pessoal de verdade,
      // não só metadado técnico).
      prisma.membro.findMany({
        where: { usuarioId: usuario.id },
        orderBy: { criadoEm: "asc" },
        select: {
          papel: true,
          criadoEm: true,
          organizacao: { select: { nome: true, slug: true } },
        },
      }),
      // Convites que a pessoa criou (não os que recebeu — esses não deixam
      // rastro em nome dela até serem aceitos).
      prisma.conviteOrganizacao.findMany({
        where: { criadoPorId: usuario.id },
        orderBy: { criadoEm: "desc" },
        select: {
          email: true,
          papel: true,
          aceitoEm: true,
          criadoEm: true,
          organizacao: { select: { nome: true } },
        },
      }),
    ]);

  await registrarEvento({ req, evento: "dados_exportados", usuarioId: usuario.id });

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
    passkeys,
    logsAuditoria,
    organizacoes: membros.map(({ organizacao, ...resto }) => ({ ...resto, ...organizacao })),
    convitesCriados,
  });
}
