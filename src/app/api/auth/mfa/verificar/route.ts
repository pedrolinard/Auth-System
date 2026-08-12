import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { consumirDesafioMfaJti } from "@/lib/desafioMfa";
import { ErroSegredoMfaIlegivel, verificarCodigoMfaSemReplay } from "@/lib/mfa";
import { limiteExcedido, obterIp } from "@/lib/rateLimit";
import { criarSessao } from "@/lib/sessao";
import { estaSuspenso, mensagemSuspensao } from "@/lib/suspensao";
import { verificarTokenDesafioMfa } from "@/lib/token";
import { esquemaVerificacaoMfa } from "@/lib/validacao";

const MAX_TENTATIVAS_MFA = 5;
const JANELA_MFA_MS = 5 * 60 * 1000;

export async function POST(req: Request) {
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
  const dadosValidados = esquemaVerificacaoMfa.safeParse(corpo);
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
  if (!usuario?.mfaAtivado || !usuario.mfaSecret) {
    return NextResponse.json(
      { erro: "Desafio de MFA inválido ou expirado. Faça login novamente." },
      { status: 401 },
    );
  }

  let codigoValido: boolean;
  try {
    codigoValido = await verificarCodigoMfaSemReplay(
      usuario.id,
      usuario.mfaSecret,
      usuario.email,
      codigo,
    );
  } catch (erro) {
    if (erro instanceof ErroSegredoMfaIlegivel) {
      return NextResponse.json(
        { erro: "Não foi possível verificar o código agora. Tente novamente mais tarde." },
        { status: 500 },
      );
    }
    throw erro;
  }
  if (!codigoValido) {
    await registrarEvento({ req, evento: "mfa_codigo_falha", usuarioId: usuario.id });
    return NextResponse.json({ erro: "Código inválido." }, { status: 401 });
  }

  // Cobre a janela entre o desafio de MFA (até 5 min) e a confirmação do
  // código: se um admin suspender a conta nesse meio-tempo, o login não deve
  // completar mesmo com o código certo.
  if (estaSuspenso(usuario)) {
    await registrarEvento({ req, evento: "login_bloqueado_suspenso", usuarioId: usuario.id, email: usuario.email });
    return NextResponse.json({ erro: mensagemSuspensao(usuario) }, { status: 403 });
  }

  // Consome o jti só na conclusão bem-sucedida — uma tentativa com código
  // errado não pode "gastar" o desafio, senão o usuário perderia a chance de
  // tentar de novo com o código certo.
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

  const sessao = await criarSessao(usuario);
  return NextResponse.json(sessao);
}
