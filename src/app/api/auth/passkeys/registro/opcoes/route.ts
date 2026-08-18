import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { gerarOpcoesRegistroPasskey } from "@/lib/passkey";
import { gerarTokenDesafioPasskey } from "@/lib/token";

// Gera as opções que o browser passa pra navigator.credentials.create(...) —
// autenticado, porque adicionar uma passkey é sempre um passo de "reforçar"
// uma conta já logada (o primeiro fator continua sendo e-mail+senha).
export async function POST(req: Request) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });
  if (!usuario) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const credenciaisExistentes = await prisma.passkeyCredencial.findMany({
    where: { usuarioId: usuario.id },
    select: { credentialId: true, transportes: true },
  });

  const options = await gerarOpcoesRegistroPasskey(usuario, credenciaisExistentes);
  const { token: passkeyToken } = await gerarTokenDesafioPasskey(options.challenge, usuario.id);

  return NextResponse.json({ options, passkeyToken });
}
