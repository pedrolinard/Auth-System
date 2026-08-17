import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { enviarEmailEmailAlterado } from "@/lib/email";
import { verificarTokenAlteracaoEmail } from "@/lib/token";
import { esquemaConfirmarAlteracaoEmail } from "@/lib/validacao";

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaConfirmarAlteracaoEmail.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const payload = await verificarTokenAlteracaoEmail(dadosValidados.data.token);
  if (!payload) {
    return NextResponse.json(
      { erro: "Link de confirmação inválido ou expirado." },
      { status: 401 },
    );
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });
  if (!usuario) {
    return NextResponse.json(
      { erro: "Link de confirmação inválido ou expirado." },
      { status: 401 },
    );
  }

  const emailAntigo = usuario.email;

  try {
    // O token carrega o novoEmail direto no JWT (não reconsulta o pedido
    // original) — outra conta pode ter registrado esse mesmo e-mail entre o
    // pedido e a confirmação (o link fica de pé por até 1h), então a
    // constraint @unique de Usuario.email é a defesa real contra a corrida,
    // não uma checagem prévia aqui.
    await prisma.usuario.update({
      where: { id: usuario.id },
      // O endereço acabou de ser confirmado clicando no link enviado pra
      // ele — não faz sentido pedir uma segunda verificação de e-mail.
      data: { email: payload.novoEmail, emailVerificado: true },
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return NextResponse.json({ erro: "Este e-mail já está em uso." }, { status: 409 });
    }
    throw erro;
  }

  await registrarEvento({
    req,
    evento: "email_alterado",
    usuarioId: usuario.id,
    email: emailAntigo,
  });
  await enviarEmailEmailAlterado(emailAntigo, payload.novoEmail);

  return NextResponse.json({ sucesso: true, novoEmail: payload.novoEmail });
}
