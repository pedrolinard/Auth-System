import "server-only";

import { NextResponse } from "next/server";
import { registrarEvento } from "@/lib/auditoria";
import { limitesMfa } from "@/lib/conclusaoMfa";
import { ErroSegredoMfaIlegivel, verificarCodigoMfaSemReplay } from "@/lib/mfa";
import { obterIp, reservarTentativas } from "@/lib/rateLimit";

// Confirmação do código do autenticador numa sessão já autenticada (ativar e
// desativar o MFA, regenerar os códigos de backup): um access token roubado
// sozinho não basta. Mesmo orçamento de tentativas do login com MFA — por IP
// e por conta, reservado ANTES de conferir (ver reservarTentativas) — pra
// pedidos simultâneos não passarem todos pela checagem. Devolve a resposta de
// erro pronta, ou null quando o código confere.
export async function conferirCodigoMfaAtual(
  req: Request,
  usuario: { id: string; email: string; aplicacaoId: string; mfaSecret: string },
  codigo: string,
): Promise<NextResponse | null> {
  const reserva = await reservarTentativas(limitesMfa(obterIp(req), usuario, "mfa_codigo_falha"));
  if (!reserva) {
    return NextResponse.json({ erro: "Muitas tentativas. Tente novamente mais tarde." }, { status: 429 });
  }

  let codigoValido: boolean;
  try {
    codigoValido = await verificarCodigoMfaSemReplay(usuario.id, usuario.mfaSecret, usuario.email, codigo);
  } catch (erro) {
    // Falha nossa, não da pessoa: não conta como tentativa.
    await reserva.liberar();
    if (erro instanceof ErroSegredoMfaIlegivel) {
      return NextResponse.json(
        { erro: "Não foi possível verificar o código agora. Tente novamente mais tarde." },
        { status: 500 },
      );
    }
    throw erro;
  }
  if (codigoValido) {
    await reserva.liberar();
    return null;
  }

  // A reserva fica: é ela que conta esta falha.
  await registrarEvento({ req, evento: "mfa_codigo_falha", usuarioId: usuario.id });
  return NextResponse.json({ erro: "Código inválido." }, { status: 401 });
}
