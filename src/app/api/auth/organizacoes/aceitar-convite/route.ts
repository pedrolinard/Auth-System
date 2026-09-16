import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { efetivarAceiteConvite } from "@/lib/aceiteConvite";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
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

  return efetivarAceiteConvite(req, usuario, convite);
}
