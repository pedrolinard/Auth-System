import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { enviarEmailVerificacao } from "@/lib/email";
import { limiteExcedido, obterIp } from "@/lib/rateLimit";
import { gerarHashSenha } from "@/lib/senha";
import { gerarTokenVerificacaoEmail } from "@/lib/token";
import { esquemaCadastro } from "@/lib/validacao";

const MAX_TENTATIVAS_CADASTRO = 5;
const JANELA_CADASTRO_MS = 60 * 60 * 1000;

export async function POST(req: Request) {
  const ip = obterIp(req);
  if (
    await limiteExcedido({
      ip,
      evento: "cadastro_tentativa",
      maximo: MAX_TENTATIVAS_CADASTRO,
      janelaMs: JANELA_CADASTRO_MS,
    })
  ) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }
  await registrarEvento({ req, evento: "cadastro_tentativa" });

  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaCadastro.safeParse(corpo);

  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const { nome, email, senha } = dadosValidados.data;
  const senhaHash = await gerarHashSenha(senha);

  try {
    const usuario = await prisma.usuario.create({
      data: { nome, email, senhaHash },
      select: { id: true, nome: true, email: true, criadoEm: true },
    });

    await registrarEvento({ req, evento: "cadastro", usuarioId: usuario.id, email });

    const tokenVerificacao = await gerarTokenVerificacaoEmail(usuario.id);
    const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
    await enviarEmailVerificacao(email, `${baseUrl}/verificar-email?token=${tokenVerificacao}`);

    return NextResponse.json({ usuario }, { status: 201 });
  } catch (erro) {
    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === "P2002"
    ) {
      return NextResponse.json(
        { erro: "Este e-mail já está cadastrado." },
        { status: 409 },
      );
    }
    throw erro;
  }
}
