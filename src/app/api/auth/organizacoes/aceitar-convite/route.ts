import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { criarSessao } from "@/lib/sessao";
import { verificarTokenConviteOrganizacao } from "@/lib/token";
import { esquemaAceitarConvite } from "@/lib/validacao";

// Aceita um convite — exige estar AUTENTICADO (não é um link stateless puro
// como verificar-email/redefinir-senha) porque criar o Membro precisa saber
// pra QUAL conta, e a única forma segura de amarrar "este e-mail convidado" a
// "esta conta" é a pessoa já ter provado a posse fazendo login. Sem conta
// ainda, o frontend (/aceitar-convite) redireciona pro cadastro preservando
// o token, mesmo padrão de link com conta inexistente.
export async function POST(req: Request) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaAceitarConvite.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json({ erro: "Convite inválido." }, { status: 400 });
  }

  const claims = await verificarTokenConviteOrganizacao(dadosValidados.data.token);
  if (!claims) {
    return NextResponse.json(
      { erro: "Convite inválido ou expirado." },
      { status: 400 },
    );
  }

  // A conta logada precisa ser a dona do e-mail convidado — sem isso,
  // alguém que interceptasse o link (encaminhado, link compartilhado por
  // engano) conseguiria entrar na organização como SI MESMO em vez do
  // convidado de verdade.
  if (payload.email.toLowerCase() !== claims.email.toLowerCase()) {
    return NextResponse.json(
      { erro: "Este convite foi enviado para outro e-mail. Entre com a conta certa antes de aceitar." },
      { status: 403 },
    );
  }

  const convite = await prisma.conviteOrganizacao.findUnique({
    where: { id: claims.conviteId },
  });
  if (
    !convite ||
    convite.aceitoEm ||
    convite.organizacaoId !== claims.organizacaoId ||
    convite.email.toLowerCase() !== claims.email.toLowerCase()
  ) {
    return NextResponse.json(
      { erro: "Convite inválido, expirado ou já usado." },
      { status: 400 },
    );
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });
  if (!usuario) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const jaEhMembro = await prisma.membro.findUnique({
    where: {
      organizacaoId_usuarioId: { organizacaoId: convite.organizacaoId, usuarioId: usuario.id },
    },
  });

  if (!jaEhMembro) {
    try {
      await prisma.$transaction([
        prisma.membro.create({
          data: { organizacaoId: convite.organizacaoId, usuarioId: usuario.id, papel: convite.papel },
        }),
        prisma.conviteOrganizacao.update({
          where: { id: convite.id },
          data: { aceitoEm: new Date() },
        }),
      ]);
      await registrarEvento({
        req,
        evento: "convite_organizacao_aceito",
        usuarioId: usuario.id,
        email: usuario.email,
      });
    } catch (erro) {
      // Duas abas/cliques aceitando o MESMO convite ao mesmo tempo: as duas
      // passam pela checagem de jaEhMembro antes de qualquer uma escrever, a
      // segunda esbarra na constraint única de Membro. Não é erro de
      // verdade — a pessoa já entrou na organização pela outra requisição —
      // só segue pra emitir a sessão normalmente em vez de estourar 500.
      const jaMembroPorCorrida =
        erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002";
      if (!jaMembroPorCorrida) throw erro;
    }
  } else if (!convite.aceitoEm) {
    // Já era membro (ex.: dois convites concorrentes) — só fecha o convite
    // como aceito, idempotente, sem tentar criar o Membro de novo.
    await prisma.conviteOrganizacao.update({
      where: { id: convite.id },
      data: { aceitoEm: new Date() },
    });
  }

  // Entra direto na organização recém-aceita, mesma UX de criar organização.
  const sessao = await criarSessao(usuario, req, convite.organizacaoId);
  return NextResponse.json(sessao);
}
