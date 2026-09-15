import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { limparCacheAplicacoes } from "@/lib/aplicacao";
import { registrarEvento } from "@/lib/auditoria";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import {
  alvoAplicacao,
  autenticarGestorAplicacoes,
  conflitoComDominioDoProvedor,
  escopoDoGestor,
  formatarAplicacao,
  origensIncompativeisComRpId,
  SELECAO_APLICACAO_PUBLICA,
} from "@/lib/gestaoAplicacoes";
import { revogacao } from "@/lib/revogacao";
import { esquemaAtualizarAplicacao } from "@/lib/validacao";

// Edita nome, origens, RP ID de passkey e ativa/desativa. Não existe
// exclusão: Usuario e Organizacao apontam pra Aplicacao com onDelete:
// Restrict de propósito (apagar um cliente por engano não pode levar junto as
// contas dos usuários finais dele). Tirar um cliente do ar é desativar.
export async function PATCH(
  req: Request,
  { params }: RouteContext<"/api/auth/aplicacoes/[id]">,
) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }
  const acesso = await autenticarGestorAplicacoes(req);
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.erro }, { status: acesso.status });
  }
  const { gestor } = acesso;

  const { id } = await params;
  // Aplicação de outra organização é 404, não 403: nem a existência vaza.
  const atual = await prisma.aplicacao.findFirst({
    where: { id, ...escopoDoGestor(gestor) },
    select: {
      id: true,
      padrao: true,
      ativa: true,
      origens: true,
      passkeyRpId: true,
      emailRemetente: true,
      desativadaPeloOperador: true,
    },
  });
  if (!atual) {
    return NextResponse.json({ erro: "Aplicação não encontrada." }, { status: 404 });
  }

  const corpo = await req.json().catch(() => null);
  const dados = esquemaAtualizarAplicacao.safeParse(corpo);
  if (!dados.success) {
    return NextResponse.json(
      { erro: dados.error.issues[0]?.message ?? "Dados inválidos.", detalhes: dados.error.flatten() },
      { status: 400 },
    );
  }
  const mudancas = dados.data;

  if (!gestor.operador) {
    // Mesmo motivo da criação (aplicacoes/route.ts): remetente é do operador.
    if (mudancas.emailRemetente !== undefined && mudancas.emailRemetente !== atual.emailRemetente) {
      return NextResponse.json(
        { erro: "Remetente próprio é configurado por quem opera o provedor." },
        { status: 400 },
      );
    }
    if (mudancas.aprovada !== undefined) {
      return NextResponse.json(
        { erro: "Só quem opera o provedor aprova aplicações." },
        { status: 403 },
      );
    }
    // Desativada por abuso ou falta de pagamento: o próprio cliente não
    // religa.
    if (mudancas.ativa === true && atual.desativadaPeloOperador) {
      return NextResponse.json(
        { erro: "Esta aplicação foi desativada por quem opera o provedor. Fale com o suporte." },
        { status: 403 },
      );
    }
  }

  // A aplicação padrão é onde vive a conta de quem opera o provedor — e o
  // próprio painel. Desativá-la tranca todo mundo do lado de fora, inclusive
  // quem poderia reativá-la.
  if (atual.padrao && mudancas.ativa === false) {
    return NextResponse.json(
      { erro: "A aplicação padrão não pode ser desativada: o próprio painel depende dela." },
      { status: 400 },
    );
  }

  const origensFinais = mudancas.origens ?? atual.origens;
  const rpIdFinal = mudancas.passkeyRpId !== undefined ? mudancas.passkeyRpId : atual.passkeyRpId;
  if (!atual.padrao) {
    const conflito = conflitoComDominioDoProvedor(req, {
      origens: origensFinais,
      passkeyRpId: rpIdFinal,
      redirectUris: mudancas.redirectUris,
    });
    if (conflito) return NextResponse.json({ erro: conflito }, { status: 400 });
  }
  if (rpIdFinal) {
    const incompativeis = origensIncompativeisComRpId(origensFinais, rpIdFinal);
    if (incompativeis.length > 0) {
      return NextResponse.json(
        {
          erro: `O RP ID "${rpIdFinal}" não cobre ${incompativeis.join(", ")} — passkeys não funcionariam nessas origens.`,
        },
        { status: 400 },
      );
    }
  }

  // Uma passkey fica presa ao RP ID em que nasceu. Trocar o RP ID com
  // passkeys já registradas as invalida TODAS em silêncio: os usuários finais
  // só descobrem no próximo login. Recusa em vez de fazer isso sem aviso.
  if (mudancas.passkeyRpId !== undefined && mudancas.passkeyRpId !== atual.passkeyRpId) {
    const passkeys = await prisma.passkeyCredencial.count({
      where: { usuario: { aplicacaoId: id } },
    });
    if (passkeys > 0) {
      return NextResponse.json(
        {
          erro: `Esta aplicação tem ${passkeys} passkey(s) registrada(s) no RP ID atual. Trocar o RP ID invalidaria todas.`,
        },
        { status: 409 },
      );
    }
  }

  const aplicacao = await prisma.aplicacao.update({
    where: { id },
    data: {
      ...mudancas,
      // Quem desativou decide quem pode religar: o operador marca, e só ele
      // desmarca (ao reativar). Desativar pelo self-service não marca.
      ...(gestor.operador && mudancas.ativa !== undefined
        ? { desativadaPeloOperador: !mudancas.ativa }
        : {}),
    },
    select: SELECAO_APLICACAO_PUBLICA,
  });

  // Desativar derruba as sessões dos usuários finais dessa aplicação na
  // hora. Sem isso, o cliente "desativado" continuaria com sessões renovando
  // por até 30 dias — /atualizar não passa pelo resolverAplicacao. Os access
  // tokens já emitidos ainda valem até expirar (15 min), mesmo trade-off de
  // toda revogação neste projeto.
  if (atual.ativa && mudancas.ativa === false) {
    await prisma.tokenAtualizacao.updateMany({
      where: { revogadoEm: null, usuario: { aplicacaoId: id } },
      data: revogacao("aplicacao_desativada"),
    });
  }

  // Cache do processo atual zerado na hora; outras instâncias da função
  // enxergam a mudança quando o TTL delas vencer (30s — ver aplicacao.ts).
  limparCacheAplicacoes();

  await registrarEvento({
    req,
    evento:
      mudancas.ativa === false && atual.ativa
        ? "aplicacao_desativada"
        : mudancas.ativa === true && !atual.ativa
          ? "aplicacao_reativada"
          : mudancas.aprovada === true
            ? "aplicacao_aprovada"
            : "aplicacao_atualizada",
    autorId: gestor.payload.sub,
    autorEmail: gestor.payload.email,
    aplicacaoId: gestor.payload.aplicacaoId,
    organizacaoId: gestor.organizacaoDonaId ?? undefined,
    alvo: alvoAplicacao(aplicacao),
  });

  return NextResponse.json({ aplicacao: formatarAplicacao(aplicacao) });
}
