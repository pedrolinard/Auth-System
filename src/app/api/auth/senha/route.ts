import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieAtualizacao, obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { revogarDispositivosConfiaveis } from "@/lib/dispositivoConfiavel";
import { enviarEmailSenhaAlterada } from "@/lib/email";
import { limiteExcedido, limiteExcedidoPorEmail, obterIp } from "@/lib/rateLimit";
import { gerarHashSenha, verificarSenha } from "@/lib/senha";
import { senhaFoiVazada } from "@/lib/senhaVazada";
import { hashToken } from "@/lib/token";
import { esquemaTrocarSenha } from "@/lib/validacao";

// Mesma fricção dos outros endpoints que exigem reprovar uma credencial numa
// sessão já autenticada (mfa/verificar, mfa/desativar, mfa/backup): sem
// limite aqui, um access token roubado (ex.: XSS de vida curta) bastaria pra
// tentar `senhaAtual` sem parar até acertar por força bruta.
const MAX_TENTATIVAS_SENHA_ATUAL = 5;
const JANELA_SENHA_ATUAL_MS = 5 * 60 * 1000;

export async function PUT(req: Request) {
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
  const dadosValidados = esquemaTrocarSenha.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const { senhaAtual, novaSenha } = dadosValidados.data;
  const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });
  if (!usuario) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  // Limite por CONTA além do de IP, mesmo raciocínio do login: sem ele, um
  // ataque distribuído (vários IPs) contra a mesma conta furaria o limite
  // por IP sozinho.
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

  if (!(await verificarSenha(senhaAtual, usuario.senhaHash))) {
    await registrarEvento({
      req,
      evento: "senha_atual_falha",
      usuarioId: usuario.id,
      email: usuario.email,
    });
    return NextResponse.json({ erro: "Senha atual incorreta." }, { status: 401 });
  }

  if (senhaAtual === novaSenha) {
    return NextResponse.json(
      { erro: "A nova senha deve ser diferente da senha atual." },
      { status: 400 },
    );
  }

  if (await senhaFoiVazada(novaSenha)) {
    return NextResponse.json(
      {
        erro: "Essa senha apareceu em vazamentos de dados conhecidos. Escolha outra.",
      },
      { status: 400 },
    );
  }

  const senhaHash = await gerarHashSenha(novaSenha);
  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { senhaHash, senhaAlteradaEm: new Date() },
  });

  // Diferente do "esqueci a senha" (que derruba TUDO por não saber quem está
  // pedindo a troca), aqui quem chamou já provou ser dono da conta com a
  // senha atual — mantém a sessão de onde veio o pedido viva e derruba só as
  // outras, junto com qualquer "dispositivo confiável".
  const cookieAtual = await obterCookieAtualizacao();
  const hashAtual = cookieAtual ? hashToken(cookieAtual) : null;
  await prisma.tokenAtualizacao.updateMany({
    where: {
      usuarioId: usuario.id,
      revogadoEm: null,
      ...(hashAtual ? { tokenHash: { not: hashAtual } } : {}),
    },
    data: { revogadoEm: new Date() },
  });
  await revogarDispositivosConfiaveis(usuario.id);

  await registrarEvento({ req, evento: "senha_alterada", usuarioId: usuario.id });
  await enviarEmailSenhaAlterada(usuario.email);

  return NextResponse.json({ sucesso: true });
}
