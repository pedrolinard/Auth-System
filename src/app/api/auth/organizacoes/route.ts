import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { criarOrganizacao } from "@/lib/organizacao";
import { limiteExcedido, obterIp, registrarTentativaIp } from "@/lib/rateLimit";
import { criarSessao } from "@/lib/sessao";
import { esquemaCriarOrganizacao } from "@/lib/validacao";

// Toda rota autenticada que cria estado persistente tem algum limite no
// projeto (reenviar-verificacao 3/h, mfa/iniciar 10/h) — criar organização
// não tinha nenhum, apesar de gravar linhas de verdade (Organizacao, Membro,
// sessão nova) a cada chamada. Generoso o bastante pra onboarding real
// (criar duas ou três organizações num dia não é incomum).
const MAX_ORGANIZACOES_POR_HORA = 10;
const JANELA_ORGANIZACOES_MS = 60 * 60 * 1000;

// Lista as organizações de que o usuário autenticado é membro (dono, admin
// ou membro) — usado pelo seletor de organização no frontend.
export async function GET(req: Request) {
  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const membros = await prisma.membro.findMany({
    where: { usuarioId: payload.sub },
    select: {
      papel: true,
      organizacao: { select: { id: true, nome: true, slug: true } },
    },
    orderBy: { criadoEm: "asc" },
  });

  const organizacoes = membros.map(({ papel, organizacao }) => ({ ...organizacao, papel }));
  return NextResponse.json({ organizacoes });
}

// Cria uma organização NOVA (o usuário já tem pelo menos a pessoal, criada
// no cadastro) — o criador vira dono e a sessão já é reemitida pra essa
// organização ficar ativa na hora, mesma UX do cadastro (que já loga direto
// na organização pessoal recém-criada).
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
      evento: "organizacao_criada",
      maximo: MAX_ORGANIZACOES_POR_HORA,
    })
  ) {
    return NextResponse.json(
      { erro: "Muitas organizações criadas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }

  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaCriarOrganizacao.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });
  if (!usuario) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const organizacao = await prisma.$transaction((tx) =>
    criarOrganizacao(tx, dadosValidados.data.nome, usuario.id),
  );

  await registrarEvento({
    req,
    evento: "organizacao_criada",
    usuarioId: usuario.id,
    email: usuario.email,
  });
  await registrarTentativaIp({
    ip,
    evento: "organizacao_criada",
    janelaMs: JANELA_ORGANIZACOES_MS,
  });

  const sessao = await criarSessao(usuario, req, organizacao.id);
  return NextResponse.json({ organizacao, ...sessao }, { status: 201 });
}
