import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { consumirCodigoBackup, contarCodigosRestantes } from "@/lib/backupMfa";
import { limiteExcedido, obterIp } from "@/lib/rateLimit";
import { criarSessao } from "@/lib/sessao";
import { estaSuspenso, mensagemSuspensao } from "@/lib/suspensao";
import { verificarTokenDesafioMfa } from "@/lib/token";
import { esquemaCodigoBackup } from "@/lib/validacao";

const MAX_TENTATIVAS_MFA = 5;
const JANELA_MFA_MS = 5 * 60 * 1000;

// Login com um código de backup: mesmo desafio de MFA de /mfa/verificar,
// mas consumindo um recovery code em vez do TOTP — caminho pra quando o
// usuário perdeu o autenticador.
export async function POST(req: Request) {
  const ip = obterIp(req);
  if (
    await limiteExcedido({
      ip,
      evento: "mfa_backup_falha",
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
  const dadosValidados = esquemaCodigoBackup.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const { mfaToken, codigo } = dadosValidados.data;

  const payload = await verificarTokenDesafioMfa(mfaToken);
  if (!payload) {
    return NextResponse.json(
      { erro: "Desafio de MFA inválido ou expirado. Faça login novamente." },
      { status: 401 },
    );
  }

  const usuario = await prisma.usuario.findUnique({
    where: { id: payload.sub },
  });
  if (!usuario?.mfaAtivado) {
    return NextResponse.json(
      { erro: "Desafio de MFA inválido ou expirado. Faça login novamente." },
      { status: 401 },
    );
  }

  const codigoValido = await consumirCodigoBackup(usuario.id, codigo);
  if (!codigoValido) {
    await registrarEvento({ req, evento: "mfa_backup_falha", usuarioId: usuario.id });
    return NextResponse.json({ erro: "Código de backup inválido." }, { status: 401 });
  }

  // Mesmo cuidado que /mfa/verificar: cobre a janela entre o desafio de MFA
  // (até 5 min) e o consumo do código — se um admin suspender a conta nesse
  // meio-tempo, o login não deve completar mesmo com um código válido.
  if (estaSuspenso(usuario)) {
    await registrarEvento({ req, evento: "login_bloqueado_suspenso", usuarioId: usuario.id, email: usuario.email });
    return NextResponse.json({ erro: mensagemSuspensao(usuario) }, { status: 403 });
  }

  await registrarEvento({ req, evento: "mfa_backup_sucesso", usuarioId: usuario.id });

  const sessao = await criarSessao(usuario);
  const codigosBackupRestantes = await contarCodigosRestantes(usuario.id);

  return NextResponse.json({ ...sessao, codigosBackupRestantes });
}
