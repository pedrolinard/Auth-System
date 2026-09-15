import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verificarTokenVerificacaoEmail } from "@/lib/token";
import { dadosDoUsuario, emitirEventoWebhook } from "@/lib/webhooks";
import { esquemaVerificacaoEmail } from "@/lib/validacao";

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaVerificacaoEmail.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const payload = await verificarTokenVerificacaoEmail(dadosValidados.data.token);
  if (!payload) {
    return NextResponse.json(
      { erro: "Link de verificação inválido ou expirado." },
      { status: 401 },
    );
  }

  // updateMany em vez de update: o link vive 1 dia, e se a conta foi excluída
  // nesse meio-tempo o `update` estourava P2025 (500 sem corpo) em vez de
  // dizer que o link não vale mais.
  const usuario = await prisma.usuario.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, aplicacaoId: true, emailVerificado: true },
  });
  if (!usuario) {
    return NextResponse.json(
      { erro: "Link de verificação inválido ou expirado." },
      { status: 401 },
    );
  }
  // Só a primeira verificação muda algo (e avisa o webhook); abrir o link de
  // novo continua respondendo sucesso.
  const { count } = await prisma.usuario.updateMany({
    where: { id: usuario.id, emailVerificado: false },
    data: { emailVerificado: true },
  });
  if (count === 1) {
    await emitirEventoWebhook(usuario.aplicacaoId, "usuario.email_verificado", dadosDoUsuario(usuario));
  }

  return NextResponse.json({ sucesso: true });
}
