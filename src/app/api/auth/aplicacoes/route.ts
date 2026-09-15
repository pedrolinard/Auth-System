import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { limparCacheAplicacoes } from "@/lib/aplicacao";
import { registrarEvento } from "@/lib/auditoria";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import {
  autenticarOperadorProvedor,
  formatarAplicacao,
  gerarClientId,
  gerarClientSecret,
  origensIncompativeisComRpId,
  SELECAO_APLICACAO_PUBLICA,
} from "@/lib/gestaoAplicacoes";
import { esquemaCriarAplicacao } from "@/lib/validacao";

// Lista todas as aplicações clientes do provedor, a padrão incluída (ela é
// exibida mas protegida contra desativação — ver [id]/route.ts).
export async function GET(req: Request) {
  const acesso = await autenticarOperadorProvedor(req);
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.erro }, { status: acesso.status });
  }

  const aplicacoes = await prisma.aplicacao.findMany({
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
  const acesso = await autenticarOperadorProvedor(req);
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.erro }, { status: acesso.status });
  }

  const corpo = await req.json().catch(() => null);
  const dados = esquemaCriarAplicacao.safeParse(corpo);
  if (!dados.success) {
    return NextResponse.json(
      { erro: dados.error.issues[0]?.message ?? "Dados inválidos.", detalhes: dados.error.flatten() },
      { status: 400 },
    );
  }

  const { nome, origens, passkeyRpId, emailRemetente, urlLinks, logoUrl } = dados.data;
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
      // `padrao` nunca vem do corpo: a aplicação padrão é única (índice
      // parcial) e nasce do backfill, não do painel.
    },
    select: SELECAO_APLICACAO_PUBLICA,
  });
  limparCacheAplicacoes();

  await registrarEvento({
    req,
    evento: "aplicacao_criada",
    autorId: acesso.payload.sub,
    autorEmail: acesso.payload.email,
    // Trilha do OPERADOR: o evento aparece no painel de auditoria da
    // aplicação padrão, onde quem opera o provedor olha.
    aplicacaoId: acesso.payload.aplicacaoId,
  });

  return NextResponse.json(
    { aplicacao: formatarAplicacao(aplicacao), clientSecret: segredo },
    { status: 201 },
  );
}
