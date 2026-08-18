import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { consumirDesafioMfaJti } from "@/lib/desafioMfa";
import { enviarEmailPasskeyAlterada } from "@/lib/email";
import { verificarRegistroPasskey } from "@/lib/passkey";
import { verificarTokenDesafioPasskey } from "@/lib/token";
import { esquemaPasskeyRegistroConfirmar } from "@/lib/validacao";

export async function POST(req: Request) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

  const payloadAuth = await autenticarRequisicao(req);
  if (!payloadAuth) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaPasskeyRegistroConfirmar.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }
  const { passkeyToken, resposta, nome } = dadosValidados.data;

  const payloadDesafio = await verificarTokenDesafioPasskey(passkeyToken);
  // payloadDesafio.sub precisa bater com quem está autenticado agora — sem
  // essa checagem, um passkeyToken vazado (ex.: XSS de outra aba) poderia
  // ser usado pra plantar uma passkey na conta de outra pessoa.
  if (!payloadDesafio || payloadDesafio.sub !== payloadAuth.sub) {
    return NextResponse.json(
      { erro: "Desafio de passkey inválido ou expirado. Tente novamente." },
      { status: 401 },
    );
  }

  // Mesma tabela de uso único do desafio de MFA (consumirDesafioMfaJti) — o
  // jti é só um identificador global aleatório, nada específico de TOTP;
  // sem consumo de uso único, uma resposta de attestation capturada em
  // trânsito poderia ser reapresentada até o token expirar.
  const desafioAindaValido = await consumirDesafioMfaJti(
    payloadDesafio.jti,
    new Date((payloadDesafio.exp ?? 0) * 1000),
  );
  if (!desafioAindaValido) {
    return NextResponse.json(
      { erro: "Desafio de passkey inválido ou expirado. Tente novamente." },
      { status: 401 },
    );
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: payloadAuth.sub } });
  if (!usuario) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  let verificacao;
  try {
    verificacao = await verificarRegistroPasskey(
      resposta as unknown as RegistrationResponseJSON,
      payloadDesafio.challenge,
    );
  } catch {
    return NextResponse.json({ erro: "Não foi possível verificar a passkey." }, { status: 400 });
  }
  if (!verificacao.verified || !verificacao.registrationInfo) {
    return NextResponse.json({ erro: "Não foi possível verificar a passkey." }, { status: 400 });
  }

  const { credential } = verificacao.registrationInfo;
  await prisma.passkeyCredencial.create({
    data: {
      usuarioId: usuario.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64"),
      contador: credential.counter,
      transportes: credential.transports ?? [],
      nome: nome || null,
    },
  });

  await registrarEvento({ req, evento: "passkey_adicionada", usuarioId: usuario.id, email: usuario.email });
  await enviarEmailPasskeyAlterada(usuario.email, "adicionada");

  return NextResponse.json({ sucesso: true });
}
