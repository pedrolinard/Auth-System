import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { verificarCodigoMfa } from "@/lib/mfa";
import { limiteExcedido, obterIp } from "@/lib/rateLimit";
import { esquemaCodigoMfa } from "@/lib/validacao";

const MAX_TENTATIVAS_MFA = 5;
const JANELA_MFA_MS = 5 * 60 * 1000;

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
      evento: "mfa_codigo_falha",
      maximo: MAX_TENTATIVAS_MFA,
      janelaMs: JANELA_MFA_MS,
    })
  ) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }

  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaCodigoMfa.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const usuario = await prisma.usuario.findUnique({
    where: { id: payload.sub },
  });
  if (!usuario?.mfaAtivado || !usuario.mfaSecret) {
    return NextResponse.json(
      { erro: "A verificação em duas etapas não está ativada." },
      { status: 409 },
    );
  }

  // Exige o código atual para desativar, para que um access token roubado
  // (vida curta) sozinho não baste para remover a segunda camada.
  const codigoValido = verificarCodigoMfa(
    usuario.mfaSecret,
    usuario.email,
    dadosValidados.data.codigo,
  );
  if (!codigoValido) {
    await registrarEvento({ req, evento: "mfa_codigo_falha", usuarioId: usuario.id });
    return NextResponse.json({ erro: "Código inválido." }, { status: 401 });
  }

  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { mfaAtivado: false, mfaSecret: null },
  });

  return NextResponse.json({ sucesso: true });
}
