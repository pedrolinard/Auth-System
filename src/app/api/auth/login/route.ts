import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { limiteExcedido, obterIp } from "@/lib/rateLimit";
import { verificarSenha } from "@/lib/senha";
import { criarSessao } from "@/lib/sessao";
import { gerarTokenDesafioMfa } from "@/lib/token";
import { esquemaLogin } from "@/lib/validacao";

const MAX_TENTATIVAS_LOGIN = 5;
const JANELA_LOGIN_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  const ip = obterIp(req);
  if (
    await limiteExcedido({
      ip,
      evento: "login_falha",
      maximo: MAX_TENTATIVAS_LOGIN,
      janelaMs: JANELA_LOGIN_MS,
    })
  ) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }

  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaLogin.safeParse(corpo);

  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const { email, senha } = dadosValidados.data;

  const usuario = await prisma.usuario.findUnique({ where: { email } });
  const credenciaisValidas =
    usuario && (await verificarSenha(senha, usuario.senhaHash));

  if (!credenciaisValidas) {
    await registrarEvento({ req, evento: "login_falha", email });
    return NextResponse.json(
      { erro: "E-mail ou senha inválidos." },
      { status: 401 },
    );
  }

  await registrarEvento({ req, evento: "login_sucesso", usuarioId: usuario.id, email });

  if (usuario.mfaAtivado) {
    const mfaToken = await gerarTokenDesafioMfa(usuario.id);
    return NextResponse.json({ mfaObrigatorio: true, mfaToken });
  }

  const sessao = await criarSessao(usuario);
  return NextResponse.json(sessao);
}
