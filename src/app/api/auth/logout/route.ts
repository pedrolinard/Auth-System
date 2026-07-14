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
import { hashToken } from "@/lib/token";

export async function POST(req: Request) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

  const tokenAtualizacao = await obterCookieAtualizacao();

  if (tokenAtualizacao) {
    const registro = await prisma.tokenAtualizacao.findUnique({
      where: { tokenHash: hashToken(tokenAtualizacao) },
    });

    await prisma.tokenAtualizacao.updateMany({
      where: { tokenHash: hashToken(tokenAtualizacao), revogadoEm: null },
      data: { revogadoEm: new Date() },
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
