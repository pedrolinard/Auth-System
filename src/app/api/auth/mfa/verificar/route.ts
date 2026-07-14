import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { limiteExcedido, obterIp } from "@/lib/rateLimit";
import { criarSessao } from "@/lib/sessao";
import { verificarCodigoMfa } from "@/lib/mfa";
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

  const codigoValido = verificarCodigoMfa(usuario.mfaSecret, usuario.email, codigo);
  if (!codigoValido) {
    await registrarEvento({ req, evento: "mfa_codigo_falha", usuarioId: usuario.id });
    return NextResponse.json({ erro: "Código inválido." }, { status: 401 });
  }

  const sessao = await criarSessao(usuario);
  return NextResponse.json(sessao);
}
