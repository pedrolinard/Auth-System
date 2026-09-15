import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { enviarEmailReusoTokenDetectado } from "@/lib/email";
import {
  definirCookieAcesso,
  definirCookieAtualizacao,
  definirCookieCsrf,
  obterCookieAtualizacao,
  obterCookieCsrf,
} from "@/lib/cookies";
import { csrfValido, gerarTokenCsrf } from "@/lib/csrf";
import { obterGeo } from "@/lib/geo";
import { limiteExcedido, obterIp, registrarTentativaIp } from "@/lib/rateLimit";
import { aplicacaoEstaAtiva, contextoEmail } from "@/lib/aplicacao";
import { revogacao, revogacaoIndicaRoubo } from "@/lib/revogacao";
import { bloqueioPorSuspensao, resolverOrganizacaoAtiva } from "@/lib/sessao";
import { estaSuspenso } from "@/lib/suspensao";
import {
  gerarTokenAcesso,
  gerarTokenAtualizacao,
  hashToken,
  verificarTokenAtualizacao,
} from "@/lib/token";
import { esquemaAtualizacao } from "@/lib/validacao";

// A renovação faz `verificarTokenAtualizacao` + um `findUnique` a cada
// chamada; sem limite, dava pra martelar o endpoint com lixo (cada tentativa
// custa CPU de verificação de JWT + uma ida ao banco). Conta só as FALHAS
// por IP — uma renovação legítima não escreve nada — com folga pra não
// travar várias sessões atrás do mesmo NAT.
const MAX_FALHAS_ATUALIZAR = 20;
const JANELA_ATUALIZAR_MS = 15 * 60 * 1000;

const RESPOSTA_TOKEN_INVALIDO = { erro: "Token de atualização inválido ou expirado." };

export async function POST(req: Request) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

  const ip = obterIp(req);
  if (
    await limiteExcedido({
      ip,
      evento: "atualizar_falha",
      maximo: MAX_FALHAS_ATUALIZAR,
    })
  ) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }

  // Token apresentado mas inválido/desconhecido/expirado — o sinal que o
  // rate limit acima conta. Só é chamado nos caminhos de token ruim, nunca
  // numa renovação bem-sucedida.
  const recusarTokenInvalido = async () => {
    await registrarEvento({ req, evento: "atualizar_falha" });
    await registrarTentativaIp({ ip, evento: "atualizar_falha", janelaMs: JANELA_ATUALIZAR_MS });
    return NextResponse.json(RESPOSTA_TOKEN_INVALIDO, { status: 401 });
  };

  const corpo = await req.json().catch(() => ({}));
  const tokenDoCorpo = esquemaAtualizacao.safeParse(corpo);

  // Aceita o token de atualização tanto pelo cookie (fluxo de navegador)
  // quanto pelo corpo da requisição (fluxo de apps/serviços sem cookies).
  const tokenRecebido =
    (await obterCookieAtualizacao()) ??
    (tokenDoCorpo.success ? tokenDoCorpo.data.tokenAtualizacao : undefined);

  if (!tokenRecebido) {
    return NextResponse.json(
      { erro: "Token de atualização não informado." },
      { status: 401 },
    );
  }

  const payload = await verificarTokenAtualizacao(tokenRecebido);
  if (!payload) {
    return recusarTokenInvalido();
  }

  const tokenHash = hashToken(tokenRecebido);
  const registroToken = await prisma.tokenAtualizacao.findUnique({
    where: { tokenHash },
    include: { usuario: true },
  });

  if (!registroToken) {
    return recusarTokenInvalido();
  }

  // Aplicação desativada não renova sessão — inclusive uma que tenha escapado
  // da revogação em massa (criada por outra instância durante os até 30s de
  // cache da aplicação, ver aplicacao.ts).
  if (!(await aplicacaoEstaAtiva(registroToken.usuario.aplicacaoId))) {
    return recusarTokenInvalido();
  }

  if (registroToken.revogadoEm) {
    // Revogado por outro motivo que não a rotação (logout, troca de senha,
    // suspensão, limite de sessões...): o navegador da pessoa reapresentar
    // esse token é o esperado — ele não tem como saber que a sessão caiu.
    // Só recusa. Ver src/lib/revogacao.ts.
    if (!revogacaoIndicaRoubo(registroToken.revogadoMotivo)) {
      return recusarTokenInvalido();
    }
    // Revogado pela ROTAÇÃO e reapresentado: o sinal clássico de roubo. A
    // rotação já emitiu um substituto, então só existem duas explicações — o
    // dono legítimo reusou uma cópia antiga por engano, ou um atacante está
    // com o token vazado. Não dá pra distinguir, então a resposta segura é
    // derrubar a família inteira (todas as sessões do usuário). O motivo
    // gravado é outro ("reuso_detectado"), senão cada reapresentação de um
    // desses tokens dispararia o alerta de novo.
    await prisma.tokenAtualizacao.updateMany({
      where: { usuarioId: registroToken.usuarioId, revogadoEm: null },
      data: revogacao("reuso_detectado"),
    });
    await registrarEvento({
      req,
      evento: "reuso_token_detectado",
      usuarioId: registroToken.usuarioId,
    });
    await enviarEmailReusoTokenDetectado(
      registroToken.usuario.email,
      (await contextoEmail(registroToken.usuario.aplicacaoId)).marca,
    );
    return recusarTokenInvalido();
  }

  if (registroToken.expiraEm < new Date()) {
    return recusarTokenInvalido();
  }

  // Organização da sessão: normalmente já vem salva no próprio token de
  // atualização (setada em criarSessao); sessões emitidas ANTES da coluna
  // existir caem no mesmo fallback que uma sessão nova usaria. Relê o papel
  // do Membro (não copia do token antigo) pelo mesmo motivo do IP/UA/geo
  // abaixo — se alguém mudou o papel do usuário nessa organização desde o
  // último login, o token renovado já reflete o valor atual.
  let organizacaoId = registroToken.organizacaoId;
  if (!organizacaoId) {
    // Sem organização acessível (suspenso em todas) é recusa, não 500.
    if (await bloqueioPorSuspensao(registroToken.usuarioId)) {
      return recusarTokenInvalido();
    }
    organizacaoId = (await resolverOrganizacaoAtiva(registroToken.usuarioId)).organizacaoId;
  }
  const membro = await prisma.membro.findUnique({
    where: { organizacaoId_usuarioId: { organizacaoId, usuarioId: registroToken.usuarioId } },
    select: { papel: true, suspenso: true, suspensoAte: true },
  });
  if (!membro || estaSuspenso(membro)) {
    // Foi removido da organização (ou ela foi excluída), ou suspenso nela,
    // desde o login — sessão não faz mais sentido pra essa organização, trata
    // como token inválido em vez de reemitir acesso. Suspender já revoga as
    // sessões da organização; isto cobre a sessão que escapou disso (ex.:
    // sessão antiga sem organizacaoId, resolvida pelo fallback acima).
    return recusarTokenInvalido();
  }

  // Rotação: revoga o token usado e emite um novo par de tokens. IP/UA/geo
  // são recapturados da requisição de refresh (não copiados do token
  // antigo) pra a lista de sessões refletir onde o dispositivo está agora,
  // não onde estava no login original.
  const { token: novoTokenAtualizacao, expiraEm: novaExpiracao } =
    await gerarTokenAtualizacao(registroToken.usuarioId);
  const geo = obterGeo(req);

  try {
    const rotacionou = await prisma.$transaction(async (tx) => {
      // Só revoga se o token AINDA estiver ativo, e o motivo vai no mesmo
      // update (não existe instante com o token revogado sem motivo). Sem o
      // `revogadoEm: null`, duas renovações simultâneas do mesmo token (duas
      // abas, ou o dono e um ladrão ao mesmo tempo) passavam as duas pela
      // checagem lá em cima e abriam duas sessões — e uma suspensão que
      // caísse nesse intervalo tinha o motivo sobrescrito e a sessão renovada.
      const { count } = await tx.tokenAtualizacao.updateMany({
        where: { id: registroToken.id, revogadoEm: null },
        data: revogacao("rotacao"),
      });
      if (count !== 1) return false;
      await tx.tokenAtualizacao.create({
        data: {
          tokenHash: hashToken(novoTokenAtualizacao),
          usuarioId: registroToken.usuarioId,
          organizacaoId,
          expiraEm: novaExpiracao,
          ip: obterIp(req),
          userAgent: req.headers.get("user-agent"),
          geoCidade: geo.cidade,
          geoRegiao: geo.regiao,
          geoPais: geo.pais,
        },
      });
      return true;
    });
    if (!rotacionou) {
      // Perdeu a corrida pra outra renovação (ou uma revogação) do mesmo
      // token. Só recusa — NÃO é reuso: duas abas renovando juntas é o caso
      // comum, e o navegador serializa as renovações entre abas
      // (tentarAtualizarToken em clienteAuth.ts), então a próxima tentativa
      // já sai com o cookie novo.
      return NextResponse.json(RESPOSTA_TOKEN_INVALIDO, { status: 401 });
    }
  } catch (erro) {
    console.error("Falha ao rotacionar token de atualização:", erro);
    return NextResponse.json(
      { erro: "Não foi possível renovar a sessão. Tente novamente." },
      { status: 500 },
    );
  }

  const novoTokenAcesso = await gerarTokenAcesso({
    sub: registroToken.usuario.id,
    email: registroToken.usuario.email,
    papel: registroToken.usuario.papel,
    aplicacaoId: registroToken.usuario.aplicacaoId,
    organizacaoId,
    papelOrganizacao: membro.papel,
  });

  await definirCookieAtualizacao(novoTokenAtualizacao);
  await definirCookieAcesso(novoTokenAcesso);
  await definirCookieCsrf(gerarTokenCsrf());

  return NextResponse.json({
    tokenAcesso: novoTokenAcesso,
    tokenAtualizacao: novoTokenAtualizacao,
  });
}
