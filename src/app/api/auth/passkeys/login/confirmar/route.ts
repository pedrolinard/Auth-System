import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { consumirDesafioMfaJti } from "@/lib/desafioMfa";
import { enviarEmailDispositivoNovo, enviarEmailViagemImpossivel } from "@/lib/email";
import { formatarLocalizacao, obterGeo } from "@/lib/geo";
import { origemPermitida, resolverAplicacao } from "@/lib/aplicacao";
import { verificarLoginPasskey } from "@/lib/passkey";
import {
  limiteExcedido,
  limiteExcedidoPorEmail,
  obterIp,
  registrarTentativaEmail,
  registrarTentativaIp,
} from "@/lib/rateLimit";
import { criarSessao } from "@/lib/sessao";
import { estaSuspenso, mensagemSuspensao } from "@/lib/suspensao";
import { verificarTokenDesafioPasskey } from "@/lib/token";
import { esquemaPasskeyLoginConfirmar } from "@/lib/validacao";

// Verificação criptográfica de verdade acontece aqui (ao contrário de
// /login/opcoes) — é aqui que o rate limit importa. Mesmo com WebAuthn sendo
// naturalmente resistente a automação (não dá pra forjar uma assinatura sem
// a chave privada do authenticator), ainda vale limitar por IP contra spam
// de payloads malformados/aleatórios.
const MAX_TENTATIVAS_LOGIN_PASSKEY = 20;
const JANELA_LOGIN_PASSKEY_MS = 15 * 60 * 1000;

// Mesma janela de "viagem impossível" usada no login por senha (ver
// /api/auth/login) — heurística grosseira mas honesta pra alertar login em
// país diferente do último num intervalo curto demais pra ser real.
const JANELA_VIAGEM_IMPOSSIVEL_MS = 2 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const aplicacao = await resolverAplicacao(req);
  if (!aplicacao) {
    return NextResponse.json({ erro: "Aplicação inválida ou desativada." }, { status: 400 });
  }
  if (!origemPermitida(aplicacao, req)) {
    return NextResponse.json({ erro: "Origem não autorizada para esta aplicação." }, { status: 403 });
  }

  const ip = obterIp(req);
  if (
    await limiteExcedido({
      ip,
      evento: "passkey_login_falha",
      maximo: MAX_TENTATIVAS_LOGIN_PASSKEY,
    })
  ) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }

  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaPasskeyLoginConfirmar.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }
  const { passkeyToken, resposta } = dadosValidados.data;

  const payloadDesafio = await verificarTokenDesafioPasskey(passkeyToken);
  if (!payloadDesafio) {
    return NextResponse.json(
      { erro: "Desafio de passkey inválido ou expirado. Tente novamente." },
      { status: 401 },
    );
  }

  const credentialId = typeof resposta.id === "string" ? resposta.id : null;
  const credencial = credentialId
    ? await prisma.passkeyCredencial.findUnique({
        where: { credentialId },
        include: { usuario: true },
      })
    : null;

  if (!credencial) {
    await registrarEvento({ req, evento: "passkey_login_falha", aplicacaoId: aplicacao.id });
    // Ainda não sabemos de qual conta é (credentialId não bateu com
    // nenhuma) — só dá pra alimentar o contador por IP aqui, o por e-mail
    // exige já ter encontrado a credencial (abaixo).
    await registrarTentativaIp({
      ip,
      evento: "passkey_login_falha",
      janelaMs: JANELA_LOGIN_PASSKEY_MS,
    });
    return NextResponse.json({ erro: "Passkey não reconhecida." }, { status: 401 });
  }
  const { usuario } = credencial;

  // Uma passkey de outra aplicação não autentica aqui. Na prática o RP ID já
  // barraria (a credencial nasceu presa ao domínio do outro cliente e a
  // verificação usaria o RP ID deste), mas duas aplicações podem
  // legitimamente compartilhar o mesmo domínio-pai — e nesse caso só esta
  // checagem separa uma da outra. Resposta idêntica à de credencial
  // desconhecida: dizer "essa passkey é de outro cliente" confirmaria a
  // existência da conta lá.
  if (usuario.aplicacaoId !== aplicacao.id) {
    await registrarEvento({ req, evento: "passkey_login_falha" });
    await registrarTentativaIp({
      ip,
      evento: "passkey_login_falha",
      janelaMs: JANELA_LOGIN_PASSKEY_MS,
    });
    return NextResponse.json({ erro: "Passkey não reconhecida." }, { status: 401 });
  }

  if (
    await limiteExcedidoPorEmail({
      aplicacaoId: usuario.aplicacaoId,
      email: usuario.email,
      evento: "passkey_login_falha",
      maximo: MAX_TENTATIVAS_LOGIN_PASSKEY,
    })
  ) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }

  let verificacao;
  try {
    verificacao = await verificarLoginPasskey(
      resposta as unknown as AuthenticationResponseJSON,
      payloadDesafio.challenge,
      credencial,
      aplicacao,
    );
  } catch {
    await registrarEvento({ req, evento: "passkey_login_falha", usuarioId: usuario.id, email: usuario.email });
    await registrarTentativaIp({ ip, evento: "passkey_login_falha", janelaMs: JANELA_LOGIN_PASSKEY_MS });
    await registrarTentativaEmail({
      aplicacaoId: usuario.aplicacaoId,
      email: usuario.email,
      evento: "passkey_login_falha",
      janelaMs: JANELA_LOGIN_PASSKEY_MS,
    });
    return NextResponse.json({ erro: "Não foi possível verificar a passkey." }, { status: 401 });
  }
  if (!verificacao.verified) {
    await registrarEvento({ req, evento: "passkey_login_falha", usuarioId: usuario.id, email: usuario.email });
    await registrarTentativaIp({ ip, evento: "passkey_login_falha", janelaMs: JANELA_LOGIN_PASSKEY_MS });
    await registrarTentativaEmail({
      aplicacaoId: usuario.aplicacaoId,
      email: usuario.email,
      evento: "passkey_login_falha",
      janelaMs: JANELA_LOGIN_PASSKEY_MS,
    });
    return NextResponse.json({ erro: "Não foi possível verificar a passkey." }, { status: 401 });
  }

  if (estaSuspenso(usuario)) {
    await registrarEvento({ req, evento: "login_bloqueado_suspenso", usuarioId: usuario.id, email: usuario.email });
    return NextResponse.json({ erro: mensagemSuspensao(usuario) }, { status: 403 });
  }

  // Só consome o desafio na conclusão bem-sucedida (mesmo raciocínio do
  // desafio de MFA): impede que esta MESMA resposta assinada seja
  // reapresentada pra logar de novo, sem invalidar uma tentativa legítima
  // por um motivo alheio (ex.: conta suspensa no meio do caminho).
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

  // Contador precisa SUBIR a cada uso — authenticator genuíno nunca
  // reusa/retrocede. newCounter já validado contra o valor salvo dentro de
  // verificarLoginPasskey/verifyAuthenticationResponse.
  await prisma.passkeyCredencial.update({
    where: { id: credencial.id },
    data: { contador: verificacao.authenticationInfo.newCounter, ultimoUsoEm: new Date() },
  });

  // Mesma lógica de "dispositivo novo" / "viagem impossível" do login por
  // senha — reconhece um (ip, userAgent) já visto tanto em login por senha
  // quanto por passkey, pra não mandar o e-mail de alerta à toa pra quem já
  // trocou de método de login no mesmo navegador.
  const userAgent = req.headers.get("user-agent");
  const loginAnteriorMesmoDispositivo = await prisma.logAuditoria.findFirst({
    where: {
      usuarioId: usuario.id,
      evento: { in: ["login_sucesso", "login_passkey_sucesso"] },
      ip,
      userAgent,
    },
  });
  const geoAtual = obterGeo(req);
  const ultimaSessao = await prisma.tokenAtualizacao.findFirst({
    where: { usuarioId: usuario.id },
    orderBy: { criadoEm: "desc" },
    select: { criadoEm: true, geoPais: true },
  });
  const viagemImpossivel =
    !!ultimaSessao?.geoPais &&
    !!geoAtual.pais &&
    ultimaSessao.geoPais !== geoAtual.pais &&
    Date.now() - ultimaSessao.criadoEm.getTime() < JANELA_VIAGEM_IMPOSSIVEL_MS;

  await registrarEvento({ req, evento: "login_passkey_sucesso", usuarioId: usuario.id, email: usuario.email });

  if (viagemImpossivel) {
    await registrarEvento({ req, evento: "viagem_impossivel_detectada", usuarioId: usuario.id, email: usuario.email });
    await enviarEmailViagemImpossivel(usuario.email, {
      paisAnterior: formatarLocalizacao({ cidade: null, regiao: null, pais: ultimaSessao!.geoPais }) ?? ultimaSessao!.geoPais!,
      paisAtual: formatarLocalizacao({ cidade: null, regiao: null, pais: geoAtual.pais }) ?? geoAtual.pais!,
      quando: new Date(),
    });
  } else if (!loginAnteriorMesmoDispositivo) {
    await enviarEmailDispositivoNovo(usuario.email, { ip, userAgent, quando: new Date() });
  }

  // Login por passkey já é, por natureza, posse do authenticator + presença
  // do usuário (biometria/PIN local) — equivalente a um segundo fator. Não
  // passa pelo desafio de TOTP separado, mesmo com mfaAtivado=true.
  const sessao = await criarSessao(usuario, req);
  return NextResponse.json(sessao);
}
