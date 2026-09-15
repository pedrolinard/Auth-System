import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import {
  obterCookieAtualizacao,
  obterCookieCsrf,
  removerCookieAcesso,
  removerCookieAtualizacao,
  removerCookieCsrf,
} from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { revogacao } from "@/lib/revogacao";
import { hashToken } from "@/lib/token";
import { esquemaAtualizacao } from "@/lib/validacao";

export async function POST(req: Request) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

  // Cookie (painel, navegador na mesma origem) ou corpo (aplicação cliente em
  // outro domínio, que guarda os tokens ela mesma — mesmo formato aceito por
  // /api/auth/atualizar). Sem o corpo, uma aplicação integrada pelo SDK não
  // tinha como revogar a sessão: o refresh token ficava valendo até 30 dias
  // depois de a pessoa clicar em "sair".
  const corpo = await req.json().catch(() => ({}));
  const tokenDoCorpo = esquemaAtualizacao.safeParse(corpo);
  const tokenAtualizacao =
    (await obterCookieAtualizacao()) ??
    (tokenDoCorpo.success ? tokenDoCorpo.data.tokenAtualizacao : undefined);

  if (tokenAtualizacao) {
    const registro = await prisma.tokenAtualizacao.findUnique({
      where: { tokenHash: hashToken(tokenAtualizacao) },
    });

    await prisma.tokenAtualizacao.updateMany({
      where: { tokenHash: hashToken(tokenAtualizacao), revogadoEm: null },
      data: revogacao("logout"),
    });

    if (registro) {
      await registrarEvento({ req, evento: "logout", usuarioId: registro.usuarioId });
    }
  }

  await removerCookieAtualizacao();
  await removerCookieAcesso();
  await removerCookieCsrf();

  return NextResponse.json({ sucesso: true });
}
