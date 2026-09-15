import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { aceitarIpDoUsuarioFinal, aplicacaoEstaAtiva } from "@/lib/aplicacao";
import { registrarEvento } from "@/lib/auditoria";
import { consumirCodigoBackup, contarCodigosRestantes } from "@/lib/backupMfa";
import { consumirDesafioMfaJti } from "@/lib/desafioMfa";
import {
  limiteExcedido,
  limiteExcedidoPorEmail,
  obterIp,
  registrarTentativaEmail,
  registrarTentativaIp,
} from "@/lib/rateLimit";
import { bloqueioPorSuspensao, criarSessao } from "@/lib/sessao";
import { verificarTokenDesafioMfa } from "@/lib/token";
import { esquemaCodigoBackup } from "@/lib/validacao";

const MAX_TENTATIVAS_MFA = 5;
const JANELA_MFA_MS = 5 * 60 * 1000;

// Limite por conta, mesmo motivo de /mfa/verificar.
const MAX_FALHAS_MFA_CONTA = 10;
const JANELA_MFA_CONTA_MS = 15 * 60 * 1000;

// Login com um código de backup: mesmo desafio de MFA de /mfa/verificar,
// mas consumindo um recovery code em vez do TOTP — caminho pra quando o
// usuário perdeu o autenticador.
export async function POST(req: Request) {
  await aceitarIpDoUsuarioFinal(req);
  const ip = obterIp(req);
  if (
    await limiteExcedido({
      ip,
      evento: "mfa_backup_falha",
      maximo: MAX_TENTATIVAS_MFA,
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
  // Checado ANTES de consumir o código de backup: numa aplicação desativada
  // o login não conclui, e gastar o código mesmo assim tiraria da pessoa um
  // dos 10 códigos à toa.
  if (!(await aplicacaoEstaAtiva(usuario.aplicacaoId))) {
    return NextResponse.json({ erro: "Aplicação inválida ou desativada." }, { status: 400 });
  }

  const contaMfa = { aplicacaoId: usuario.aplicacaoId, email: usuario.email, evento: "mfa_backup_falha_conta" };
  if (await limiteExcedidoPorEmail({ ...contaMfa, maximo: MAX_FALHAS_MFA_CONTA })) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }

  const codigoValido = await consumirCodigoBackup(usuario.id, codigo);
  if (!codigoValido) {
    await registrarEvento({ req, evento: "mfa_backup_falha", usuarioId: usuario.id });
    await registrarTentativaIp({ ip, evento: "mfa_backup_falha", janelaMs: JANELA_MFA_MS });
    await registrarTentativaEmail({ ...contaMfa, janelaMs: JANELA_MFA_CONTA_MS });
    return NextResponse.json({ erro: "Código de backup inválido." }, { status: 401 });
  }

  // Mesmo cuidado que /mfa/verificar: cobre a janela entre o desafio de MFA
  // (até 5 min) e o consumo do código — se um admin suspender a conta nesse
  // meio-tempo, o login não deve completar mesmo com um código válido.
  const bloqueio = await bloqueioPorSuspensao(usuario.id);
  if (bloqueio) {
    await registrarEvento({ req, evento: "login_bloqueado_suspenso", usuarioId: usuario.id, email: usuario.email });
    return NextResponse.json({ erro: bloqueio }, { status: 403 });
  }

  // Mesma proteção de uso único de /mfa/verificar: consome o jti só na
  // conclusão bem-sucedida (o código de backup já foi consumido acima,
  // então não há "tentar de novo" — mas o mfaToken em si ainda não deve
  // servir pra abrir uma segunda sessão).
  const desafioAindaValido = await consumirDesafioMfaJti(
    payload.jti,
    new Date((payload.exp ?? 0) * 1000),
  );
  if (!desafioAindaValido) {
    return NextResponse.json(
      { erro: "Desafio de MFA inválido ou expirado. Faça login novamente." },
      { status: 401 },
    );
  }

  await registrarEvento({ req, evento: "mfa_backup_sucesso", usuarioId: usuario.id });

  const sessao = await criarSessao(usuario, req);
  const codigosBackupRestantes = await contarCodigosRestantes(usuario.id);

  return NextResponse.json({ ...sessao, codigosBackupRestantes });
}
