import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { criptografar } from "@/lib/cripto";
import { csrfValido } from "@/lib/csrf";
import { gerarQrCodeMfa, gerarSegredoMfa } from "@/lib/mfa";
import { limiteExcedido, obterIp } from "@/lib/rateLimit";

// Cada chamada gera um segredo TOTP novo e grava no usuário; ativar o MFA é
// algo que se faz uma vez, então um limite baixo por IP basta pra cortar
// quem martela o endpoint (mesma fricção de reenviar-verificacao).
const MAX_TENTATIVAS_MFA_INICIAR = 10;
const JANELA_MFA_INICIAR_MS = 60 * 60 * 1000;

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
      evento: "mfa_iniciar_tentativa",
      maximo: MAX_TENTATIVAS_MFA_INICIAR,
      janelaMs: JANELA_MFA_INICIAR_MS,
    })
  ) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }
  await registrarEvento({ req, evento: "mfa_iniciar_tentativa", usuarioId: payload.sub });

  const usuario = await prisma.usuario.findUnique({
    where: { id: payload.sub },
  });
  if (!usuario) {
    return NextResponse.json(
      { erro: "Usuário não encontrado." },
      { status: 404 },
    );
  }

  if (usuario.mfaAtivado) {
    return NextResponse.json(
      { erro: "A verificação em duas etapas já está ativada." },
      { status: 409 },
    );
  }

  // Gera um segredo novo a cada chamada; fica pendente até ser confirmado
  // com um código válido em /api/auth/mfa/confirmar.
  const segredo = gerarSegredoMfa();
  // Cifrado em repouso: se o banco vazar, os segredos TOTP não vazam junto
  // (sem isso, o segundo fator de todo mundo seria anulado de uma vez).
  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { mfaSecret: criptografar(segredo) },
  });

  const { otpauthUrl, qrCodeDataUrl } = await gerarQrCodeMfa(
    segredo,
    usuario.email,
  );

  return NextResponse.json({ segredo, otpauthUrl, qrCodeDataUrl });
}
