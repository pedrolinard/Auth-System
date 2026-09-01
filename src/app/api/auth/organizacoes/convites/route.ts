import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { enviarEmailConviteOrganizacao } from "@/lib/email";
import {
  limiteExcedido,
  limiteExcedidoPorEmail,
  obterIp,
  registrarTentativaEmail,
  registrarTentativaIp,
} from "@/lib/rateLimit";
import { temPapelOrganizacao } from "@/lib/rbacOrganizacao";
import { gerarTokenConviteOrganizacao } from "@/lib/token";
import { esquemaCriarConvite } from "@/lib/validacao";

// Endpoint já autenticado, CSRF-protegido e restrito a dono/admin — o risco
// de flood de e-mail é bem menor que rotas públicas (cadastro,
// esqueci-senha), mas uma conta comprometida ainda poderia espalhar spam por
// aqui. Generoso o bastante pra uso legítimo (convidar um time inteiro de
// uma vez) sem abrir a torneira.
const MAX_CONVITES_POR_HORA = 30;
const JANELA_CONVITES_MS = 60 * 60 * 1000;

// Limite por E-MAIL ALVO, além do de IP acima — sem isso, "convidar de
// novo" pro MESMO e-mail (que reaproveita a linha e reenvia, ver abaixo)
// ficaria só preso ao teto de 30/h do admin, dando pra martelar uma única
// caixa de entrada várias vezes. Mesmo raciocínio de esqueci-senha (3/h por
// e-mail): o limite por IP sozinho não protege um ALVO específico.
const MAX_CONVITES_POR_EMAIL = 5;

// Lista os convites PENDENTES da organização ativa.
export async function GET(req: Request) {
  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }
  if (!temPapelOrganizacao(payload.papelOrganizacao, ["dono", "admin"])) {
    return NextResponse.json(
      { erro: "Acesso restrito a administradores da organização." },
      { status: 403 },
    );
  }

  const convites = await prisma.conviteOrganizacao.findMany({
    where: { organizacaoId: payload.organizacaoId, aceitoEm: null },
    orderBy: { criadoEm: "desc" },
  });

  return NextResponse.json({ convites });
}

export async function POST(req: Request) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }
  if (!temPapelOrganizacao(payload.papelOrganizacao, ["dono", "admin"])) {
    return NextResponse.json(
      { erro: "Acesso restrito a administradores da organização." },
      { status: 403 },
    );
  }

  const ip = obterIp(req);
  if (
    await limiteExcedido({
      ip,
      evento: "convite_organizacao_criado",
      maximo: MAX_CONVITES_POR_HORA,
    })
  ) {
    return NextResponse.json(
      { erro: "Muitos convites enviados. Tente novamente mais tarde." },
      { status: 429 },
    );
  }

  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaCriarConvite.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }
  const { email, papel } = dadosValidados.data;

  if (
    await limiteExcedidoPorEmail({
      email,
      evento: "convite_organizacao_criado",
      maximo: MAX_CONVITES_POR_EMAIL,
    })
  ) {
    return NextResponse.json(
      { erro: "Muitos convites enviados para este e-mail. Tente novamente mais tarde." },
      { status: 429 },
    );
  }

  const jaEhMembro = await prisma.membro.findFirst({
    where: { organizacaoId: payload.organizacaoId, usuario: { email } },
  });
  if (jaEhMembro) {
    return NextResponse.json(
      { erro: "Este e-mail já pertence à organização." },
      { status: 409 },
    );
  }

  // Reaproveita um convite pendente pro mesmo e-mail em vez de acumular
  // duplicatas — "convidar de novo" com um e-mail já esperando vira só um
  // reenvio, com o papel atualizado se mudou.
  const conviteExistente = await prisma.conviteOrganizacao.findFirst({
    where: { organizacaoId: payload.organizacaoId, email, aceitoEm: null },
  });
  const convite = conviteExistente
    ? await prisma.conviteOrganizacao.update({
        where: { id: conviteExistente.id },
        data: { papel, criadoEm: new Date() },
      })
    : await prisma.conviteOrganizacao.create({
        data: { organizacaoId: payload.organizacaoId, email, papel, criadoPorId: payload.sub },
      });

  const [organizacao, remetente] = await Promise.all([
    prisma.organizacao.findUniqueOrThrow({ where: { id: payload.organizacaoId } }),
    prisma.usuario.findUniqueOrThrow({ where: { id: payload.sub } }),
  ]);

  const token = await gerarTokenConviteOrganizacao({
    conviteId: convite.id,
    organizacaoId: payload.organizacaoId,
    email,
    papel,
  });
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
  await enviarEmailConviteOrganizacao(email, `${baseUrl}/aceitar-convite?token=${token}`, {
    organizacaoNome: organizacao.nome,
    convidadoPorNome: remetente.nome,
  });

  await registrarEvento({
    req,
    evento: "convite_organizacao_criado",
    usuarioId: payload.sub,
    email,
  });
  await registrarTentativaIp({
    ip,
    evento: "convite_organizacao_criado",
    janelaMs: JANELA_CONVITES_MS,
  });
  await registrarTentativaEmail({
    email,
    evento: "convite_organizacao_criado",
    janelaMs: JANELA_CONVITES_MS,
  });

  return NextResponse.json({ convite }, { status: 201 });
}
