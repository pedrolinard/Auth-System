import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { gerarHashSenha } from "@/lib/senha";
import { gerarTokenVerificacaoEmail } from "@/lib/token";
import { esquemaCadastro } from "@/lib/validacao";

export async function POST(req: Request) {
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

    // Sem provedor de e-mail configurado ainda: por enquanto o link de
    // verificação só é logado no console do servidor. Trocar por um envio
    // real (Resend, SES, SMTP etc.) é só plugar aqui.
    const tokenVerificacao = await gerarTokenVerificacaoEmail(usuario.id);
    const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
    console.log(
      `[dev] Link de verificação de e-mail para ${email}: ${baseUrl}/verificar-email?token=${tokenVerificacao}`,
    );

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
