import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { limparCacheAplicacoes } from "@/lib/aplicacao";
import { registrarEvento } from "@/lib/auditoria";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import {
  alvoAplicacao,
  autenticarGestorAplicacoes,
  conflitoComDominioDoProvedor,
  contarAplicacoesDaConta,
  escopoDoGestor,
  formatarAplicacao,
  gerarClientId,
  gerarClientSecret,
  MAX_APLICACOES_POR_CONTA,
  origensIncompativeisComRpId,
  SELECAO_APLICACAO_PUBLICA,
} from "@/lib/gestaoAplicacoes";
import { esquemaCriarAplicacao } from "@/lib/validacao";

// Lista as aplicações que a sessão gerencia: todas (a padrão incluída, exibida
// mas protegida contra desativação — ver [id]/route.ts) pro operador; só as da
// própria organização no self-service.
export async function GET(req: Request) {
  const acesso = await autenticarGestorAplicacoes(req);
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.erro }, { status: acesso.status });
  }

  const aplicacoes = await prisma.aplicacao.findMany({
    where: escopoDoGestor(acesso.gestor),
    select: SELECAO_APLICACAO_PUBLICA,
    orderBy: [{ padrao: "desc" }, { criadoEm: "asc" }],
  });
  return NextResponse.json({ aplicacoes: aplicacoes.map(formatarAplicacao) });
}

// Cadastra um cliente novo. A resposta é o ÚNICO momento em que o
// clientSecret aparece em texto puro — só o hash é gravado, então perdeu,
// rotaciona (POST [id]/segredo).
export async function POST(req: Request) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }
  const acesso = await autenticarGestorAplicacoes(req);
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.erro }, { status: acesso.status });
  }
  const { gestor } = acesso;

  const corpo = await req.json().catch(() => null);
  const dados = esquemaCriarAplicacao.safeParse(corpo);
  if (!dados.success) {
    return NextResponse.json(
      { erro: dados.error.issues[0]?.message ?? "Dados inválidos.", detalhes: dados.error.flatten() },
      { status: 400 },
    );
  }

  const { nome, origens, passkeyRpId, emailRemetente, urlLinks, logoUrl } = dados.data;

  if (!gestor.operador) {
    // O remetente sai do domínio verificado do PROVEDOR no Resend: deixar um
    // cliente escolhê-lo seria emprestar a reputação (e o domínio) do
    // provedor pra qualquer e-mail que ele quisesse mandar.
    if (emailRemetente) {
      return NextResponse.json(
        { erro: "Remetente próprio é configurado por quem opera o provedor." },
        { status: 400 },
      );
    }
    const existentes = await contarAplicacoesDaConta(gestor.payload.sub);
    if (existentes >= MAX_APLICACOES_POR_CONTA) {
      return NextResponse.json(
        { erro: `Você já gerencia ${existentes} aplicações, o limite do plano atual.` },
        { status: 403 },
      );
    }
  }

  const conflito = conflitoComDominioDoProvedor(req, { origens, passkeyRpId });
  if (conflito) return NextResponse.json({ erro: conflito }, { status: 400 });

  if (passkeyRpId) {
    const incompativeis = origensIncompativeisComRpId(origens, passkeyRpId);
    if (incompativeis.length > 0) {
      return NextResponse.json(
        {
          erro: `O RP ID "${passkeyRpId}" não cobre ${incompativeis.join(", ")} — passkeys não funcionariam nessas origens.`,
        },
        { status: 400 },
      );
    }
  }

  const { segredo, hash } = gerarClientSecret();
  const aplicacao = await prisma.aplicacao.create({
    data: {
      nome,
      clientId: gerarClientId(),
      clientSecretHash: hash,
      origens,
      passkeyRpId,
      emailRemetente,
      urlLinks,
      logoUrl,
      // Nunca vem do corpo: é a organização da SESSÃO (ou nenhuma, pro
      // operador). `padrao` também não: a aplicação padrão é única (índice
      // parcial) e nasce do backfill, não do painel.
      organizacaoDonaId: gestor.organizacaoDonaId,
      // Criada pelo operador já vale; self-service espera aprovação (ver
      // Aplicacao.aprovada no schema).
      aprovada: gestor.operador,
    },
    select: SELECAO_APLICACAO_PUBLICA,
  });
  limparCacheAplicacoes();

  await registrarEvento({
    req,
    evento: "aplicacao_criada",
    autorId: gestor.payload.sub,
    autorEmail: gestor.payload.email,
    // Trilha na aplicação padrão, onde vive a conta de quem agiu.
    aplicacaoId: gestor.payload.aplicacaoId,
    organizacaoId: gestor.organizacaoDonaId ?? undefined,
    alvo: alvoAplicacao(aplicacao),
  });

  return NextResponse.json(
    { aplicacao: formatarAplicacao(aplicacao), clientSecret: segredo },
    { status: 201 },
  );
}
