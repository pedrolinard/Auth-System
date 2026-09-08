import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { obterAplicacaoPorId } from "@/lib/aplicacao";
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

  // A aplicação sai da conta, não do header: o RP ID precisa ser o da
  // aplicação DONA da conta, senão a credencial nasce presa ao domínio errado
  // e nunca mais valida.
  const aplicacao = await obterAplicacaoPorId(usuario.aplicacaoId);
  const options = await gerarOpcoesRegistroPasskey(usuario, credenciaisExistentes, aplicacao);
  const { token: passkeyToken } = await gerarTokenDesafioPasskey(options.challenge, usuario.id);

  return NextResponse.json({ options, passkeyToken });
}
