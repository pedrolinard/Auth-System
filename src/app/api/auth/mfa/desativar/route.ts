import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { contextoEmail } from "@/lib/aplicacao";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { conferirCodigoMfaAtual } from "@/lib/codigoMfaAtual";
import { invalidarCodigosBackup } from "@/lib/backupMfa";
import { obterCookieCsrf } from "@/lib/cookies";
import { enviarEmailMfaDesativado } from "@/lib/email";
import { csrfValido } from "@/lib/csrf";
import { limiteExcedido, obterIp } from "@/lib/rateLimit";
import { esquemaCodigoMfa } from "@/lib/validacao";
import { dadosDoUsuario, emitirEventoWebhook } from "@/lib/webhooks";

const MAX_TENTATIVAS_MFA = 5;

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
  // (vida curta) sozinho não baste para remover a segunda camada. Mesma
  // proteção contra replay dos outros pontos que aceitam TOTP: sem ela, um
  // código já usado em /mfa/verificar ou /mfa/confirmar ainda dentro da
  // janela de ±30s poderia ser reapresentado aqui pra desativar o MFA.
  // mfaSecret repetido só pra levar o estreitamento (já conferido acima) pro tipo.
  const erroCodigo = await conferirCodigoMfaAtual(
    req,
    { ...usuario, mfaSecret: usuario.mfaSecret },
    dadosValidados.data.codigo,
  );
  if (erroCodigo) return erroCodigo;

  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { mfaAtivado: false, mfaSecret: null },
  });

  // Não faz sentido manter recovery codes de um segundo fator que não
  // existe mais — sem isso, reativar o MFA depois (com um segredo TOTP
  // novo) deixaria os códigos de backup antigos ainda válidos.
  await invalidarCodigosBackup(usuario.id);
  await registrarEvento({ req, evento: "codigos_backup_invalidados", usuarioId: usuario.id });
  await emitirEventoWebhook(usuario.aplicacaoId, "usuario.mfa_desativado", dadosDoUsuario(usuario));
  await enviarEmailMfaDesativado(usuario.email, (await contextoEmail(usuario.aplicacaoId)).marca);

  return NextResponse.json({ sucesso: true });
}
