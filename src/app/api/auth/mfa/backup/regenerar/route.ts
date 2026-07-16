import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { invalidarCodigosBackup, persistirCodigosBackup } from "@/lib/backupMfa";
import { obterCookieCsrf } from "@/lib/cookies";
import { descriptografar } from "@/lib/cripto";
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

  // Reautenticação: exige um TOTP válido (não basta o access token da sessão
  // atual) pra regenerar os códigos. Sem isso, uma sessão sequestrada
  // conseguiria rotacionar os códigos de backup silenciosamente e usá-los
  // depois — o dono legítimo nem ficaria sabendo que os códigos mudaram.
  const codigoValido = verificarCodigoMfa(
    descriptografar(usuario.mfaSecret),
    usuario.email,
    dadosValidados.data.codigo,
  );
  if (!codigoValido) {
    await registrarEvento({ req, evento: "mfa_codigo_falha", usuarioId: usuario.id });
    return NextResponse.json({ erro: "Código inválido." }, { status: 401 });
  }

  // O conjunto antigo perde validade antes do novo existir: se algum código
  // antigo vazou, ele não deve continuar utilizável depois da regeneração.
  await invalidarCodigosBackup(usuario.id);
  const codigosBackup = await persistirCodigosBackup(usuario.id);

  await registrarEvento({ req, evento: "codigos_backup_regenerados", usuarioId: usuario.id });

  return NextResponse.json({
    sucesso: true,
    codigosBackup,
    aviso:
      "Guarde esses códigos de backup em um lugar seguro agora — os códigos antigos não funcionam mais.",
  });
}
