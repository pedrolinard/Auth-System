import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieAtualizacao, obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { revogarDispositivosConfiaveis } from "@/lib/dispositivoConfiavel";
import { enviarEmailSenhaAlterada } from "@/lib/email";
import { gerarHashSenha, verificarSenha } from "@/lib/senha";
import { senhaFoiVazada } from "@/lib/senhaVazada";
import { hashToken } from "@/lib/token";
import { esquemaTrocarSenha } from "@/lib/validacao";

export async function PUT(req: Request) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
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

  if (!(await verificarSenha(senhaAtual, usuario.senhaHash))) {
    return NextResponse.json({ erro: "Senha atual incorreta." }, { status: 401 });
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
