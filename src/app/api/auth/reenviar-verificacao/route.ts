import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { enviarEmailVerificacao } from "@/lib/email";
import { limiteExcedido, obterIp } from "@/lib/rateLimit";
import { gerarTokenVerificacaoEmail } from "@/lib/token";

const MAX_TENTATIVAS_REENVIO = 3;
const JANELA_REENVIO_MS = 60 * 60 * 1000;

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
      evento: "reenvio_verificacao_tentativa",
      maximo: MAX_TENTATIVAS_REENVIO,
      janelaMs: JANELA_REENVIO_MS,
    })
  ) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }
  await registrarEvento({ req, evento: "reenvio_verificacao_tentativa", usuarioId: payload.sub });

  const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });
  if (!usuario) {
    return NextResponse.json({ erro: "Usuário não encontrado." }, { status: 404 });
  }

  if (usuario.emailVerificado) {
    return NextResponse.json({ erro: "O e-mail já está verificado." }, { status: 409 });
  }

  const token = await gerarTokenVerificacaoEmail(usuario.id);
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
  await enviarEmailVerificacao(usuario.email, `${baseUrl}/verificar-email?token=${token}`);

  return NextResponse.json({ sucesso: true });
}
