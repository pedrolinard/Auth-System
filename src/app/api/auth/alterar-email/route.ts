import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import {
  enviarEmailAlteracaoEmailSolicitada,
  enviarEmailConfirmacaoAlteracaoEmail,
} from "@/lib/email";
import { limiteExcedido, limiteExcedidoPorEmail, obterIp } from "@/lib/rateLimit";
import { verificarSenha } from "@/lib/senha";
import { gerarTokenAlteracaoEmail } from "@/lib/token";
import { esquemaAlterarEmail } from "@/lib/validacao";

// Mesma fricção dos outros pontos que reprovam a senha numa sessão já
// autenticada (senha, minha-conta DELETE): sem limite, um access token
// roubado poderia forçar bruta a `senha` sem parar.
const MAX_TENTATIVAS_SENHA_ATUAL = 5;
const JANELA_SENHA_ATUAL_MS = 5 * 60 * 1000;

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
      evento: "senha_atual_falha",
      maximo: MAX_TENTATIVAS_SENHA_ATUAL,
      janelaMs: JANELA_SENHA_ATUAL_MS,
    })
  ) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }

  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaAlterarEmail.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const { novoEmail, senha } = dadosValidados.data;
  const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });
  if (!usuario) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  if (
    await limiteExcedidoPorEmail({
      email: usuario.email,
      evento: "senha_atual_falha",
      maximo: MAX_TENTATIVAS_SENHA_ATUAL,
      janelaMs: JANELA_SENHA_ATUAL_MS,
    })
  ) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }

  if (!(await verificarSenha(senha, usuario.senhaHash))) {
    await registrarEvento({
      req,
      evento: "senha_atual_falha",
      usuarioId: usuario.id,
      email: usuario.email,
    });
    return NextResponse.json({ erro: "Senha atual incorreta." }, { status: 401 });
  }

  if (novoEmail === usuario.email) {
    return NextResponse.json(
      { erro: "O novo e-mail precisa ser diferente do atual." },
      { status: 400 },
    );
  }

  const emailEmUso = await prisma.usuario.findUnique({ where: { email: novoEmail } });
  if (emailEmUso) {
    return NextResponse.json({ erro: "Este e-mail já está em uso." }, { status: 409 });
  }

  // O e-mail da conta só muda quando o link abaixo é confirmado (ver
  // POST /api/auth/confirmar-alteracao-email) — até lá, `usuario.email`
  // continua o de sempre, então um pedido nunca sequestra a conta sozinho.
  const token = await gerarTokenAlteracaoEmail(usuario.id, novoEmail);
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
  await enviarEmailConfirmacaoAlteracaoEmail(
    novoEmail,
    `${baseUrl}/confirmar-alteracao-email?token=${token}`,
  );
  // Avisa o endereço ATUAL de que uma troca foi pedida — quem realmente é o
  // dono fica sabendo mesmo que o pedido tenha partido de uma sessão roubada.
  await enviarEmailAlteracaoEmailSolicitada(usuario.email, novoEmail);

  await registrarEvento({ req, evento: "alteracao_email_solicitada", usuarioId: usuario.id });

  return NextResponse.json({ sucesso: true });
}
