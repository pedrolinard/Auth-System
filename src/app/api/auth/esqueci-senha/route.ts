import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { enviarEmailRedefinicaoSenha } from "@/lib/email";
import { limiteExcedido, obterIp } from "@/lib/rateLimit";
import { gerarTokenRedefinicaoSenha } from "@/lib/token";
import { esquemaEsqueciSenha } from "@/lib/validacao";

const MAX_TENTATIVAS_RECUPERACAO = 5;
const JANELA_RECUPERACAO_MS = 60 * 60 * 1000;

export async function POST(req: Request) {
  const ip = obterIp(req);
  if (
    await limiteExcedido({
      ip,
      evento: "recuperacao_tentativa",
      maximo: MAX_TENTATIVAS_RECUPERACAO,
      janelaMs: JANELA_RECUPERACAO_MS,
    })
  ) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }
  await registrarEvento({ req, evento: "recuperacao_tentativa" });

  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaEsqueciSenha.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const { email } = dadosValidados.data;
  const usuario = await prisma.usuario.findUnique({ where: { email } });

  // Sempre responde com a mesma mensagem genérica, exista ou não o e-mail —
  // evita que a rota seja usada para descobrir quais e-mails têm conta
  // (mesmo princípio já aplicado em /login, que não distingue e-mail
  // inexistente de senha errada).
  if (usuario) {
    const token = await gerarTokenRedefinicaoSenha(usuario.id);
    const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
    await enviarEmailRedefinicaoSenha(email, `${baseUrl}/redefinir-senha?token=${token}`);
  }

  return NextResponse.json({
    mensagem: "Se esse e-mail estiver cadastrado, um link de redefinição foi enviado.",
  });
}
