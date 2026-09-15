import { NextResponse } from "next/server";

import { registrarEvento } from "@/lib/auditoria";
import { concluirMfaComBackup, concluirMfaComCodigo } from "@/lib/conclusaoMfa";
import { emitirCodigoAutorizacao, origemDoProprioProvedor, verificarPedidoAssinado } from "@/lib/oidc";

// Segunda etapa do login hospedado: código do autenticador ou de backup.
// O mfaToken precisa ser de conta da aplicação do pedido (opção aplicacaoId).
export async function POST(req: Request) {
  if (!origemDoProprioProvedor(req)) {
    return NextResponse.json({ erro: "Origem não autorizada." }, { status: 403 });
  }

  const corpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const pedido = await verificarPedidoAssinado(corpo?.pedido);
  if (!pedido) {
    return NextResponse.json(
      { erro: "Este pedido de login expirou. Volte para o aplicativo e tente entrar de novo." },
      { status: 400 },
    );
  }

  const concluir = corpo?.tipo === "backup" ? concluirMfaComBackup : concluirMfaComCodigo;
  const resultado = await concluir(req, corpo, { aplicacaoId: pedido.aplicacaoId });
  if (resultado.tipo === "recusa") {
    return NextResponse.json(resultado.corpo, { status: resultado.status });
  }

  const redirecionar = await emitirCodigoAutorizacao(pedido, resultado.usuario);
  if (!redirecionar) {
    return NextResponse.json(
      { erro: "Este pedido de login expirou. Volte para o aplicativo e tente entrar de novo." },
      { status: 400 },
    );
  }
  await registrarEvento({
    req,
    evento: "oidc_codigo_emitido",
    usuarioId: resultado.usuario.id,
    email: resultado.usuario.email,
    aplicacaoId: pedido.aplicacaoId,
  });
  return NextResponse.json({
    redirecionar,
    ...(resultado.codigosBackupRestantes !== null ? { codigosBackupRestantes: resultado.codigosBackupRestantes } : {}),
  });
}
