import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autenticarRequisicao } from "@/lib/autenticar";
import {
  obterCookieAtualizacao,
  obterCookieCsrf,
  removerCookieAcesso,
  removerCookieAtualizacao,
  removerCookieCsrf,
} from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { classificarDispositivo } from "@/lib/dispositivo";
import { formatarLocalizacao } from "@/lib/geo";
import { hashToken } from "@/lib/token";

export async function GET(req: Request) {
  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const cookieAtual = await obterCookieAtualizacao();
  const hashAtual = cookieAtual ? hashToken(cookieAtual) : null;

  const tokens = await prisma.tokenAtualizacao.findMany({
    where: {
      usuarioId: payload.sub,
      revogadoEm: null,
      expiraEm: { gt: new Date() },
    },
    orderBy: { criadoEm: "desc" },
    select: {
      id: true,
      tokenHash: true,
      criadoEm: true,
      expiraEm: true,
      userAgent: true,
      geoCidade: true,
      geoRegiao: true,
      geoPais: true,
    },
  });

  const sessoes = tokens.map(
    ({ id, tokenHash, criadoEm, expiraEm, userAgent, geoCidade, geoRegiao, geoPais }) => ({
      id,
      criadoEm,
      expiraEm,
      atual: tokenHash === hashAtual,
      tipoDispositivo: classificarDispositivo(userAgent),
      localizacao: formatarLocalizacao({
        cidade: geoCidade,
        regiao: geoRegiao,
        pais: geoPais,
      }),
    }),
  );

  return NextResponse.json({ sessoes });
}

// "Sair de todos os dispositivos": revoga todos os tokens de atualização
// ativos do usuário (diferente de DELETE /api/auth/sessoes/[id], que revoga
// só uma sessão específica).
export async function DELETE(req: Request) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  await prisma.tokenAtualizacao.updateMany({
    where: { usuarioId: payload.sub, revogadoEm: null },
    data: { revogadoEm: new Date() },
  });

  await removerCookieAtualizacao();
  await removerCookieAcesso();
  await removerCookieCsrf();

  return NextResponse.json({ sucesso: true });
}
