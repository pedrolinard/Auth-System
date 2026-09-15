import "server-only";

import { prisma } from "@/lib/db";
import { aplicacaoEstaAtiva, contextoEmail } from "@/lib/aplicacao";
import { registrarEvento } from "@/lib/auditoria";
import { enviarEmailReusoTokenDetectado } from "@/lib/email";
import { obterGeo } from "@/lib/geo";
import { limiteExcedido, obterIp, registrarTentativaIp } from "@/lib/rateLimit";
import { revogacao, revogacaoIndicaRoubo } from "@/lib/revogacao";
import { bloqueioPorSuspensao, resolverOrganizacaoAtiva } from "@/lib/sessao";
import { estaSuspenso } from "@/lib/suspensao";
import {
  gerarTokenAcesso,
  gerarTokenAtualizacao,
  hashToken,
  verificarTokenAtualizacao,
  type Papel,
} from "@/lib/token";

// Rotação do token de atualização, compartilhada por POST /api/auth/atualizar
// (cookies ou corpo) e pelo grant refresh_token do OpenID Connect
// (/api/oidc/token).

// A renovação faz `verificarTokenAtualizacao` + um `findUnique` a cada
// chamada; sem limite, dava pra martelar o endpoint com lixo (cada tentativa
// custa CPU de verificação de JWT + uma ida ao banco). Conta só as FALHAS
// por IP — uma renovação legítima não escreve nada — com folga pra não
// travar várias sessões atrás do mesmo NAT.
const MAX_FALHAS_ATUALIZAR = 20;
const JANELA_ATUALIZAR_MS = 15 * 60 * 1000;

// Tolerância pra reapresentar um token que ACABOU de ser rotacionado. O
// servidor rotaciona, mas a resposta pode não chegar (rede móvel caindo, aba
// fechada no meio, timeout) — o cliente tenta de novo com o token antigo,
// porque o cookie/armazenamento novo nunca foi gravado. Sem esta janela, essa
// falha de rede comum era tratada como roubo: derrubava todas as sessões da
// pessoa e mandava e-mail de atividade suspeita. Dentro dela a reapresentação
// só é recusada. O custo é não detectar um ladrão que use o token nestes
// mesmos segundos — o mesmo trade-off do "reuse interval" do Auth0.
const TOLERANCIA_REAPRESENTACAO_MS = 30 * 1000;

const RESPOSTA_TOKEN_INVALIDO = { erro: "Token de atualização inválido ou expirado." };

export type ResultadoRotacao =
  | { tipo: "recusa"; status: number; corpo: Record<string, unknown> }
  | {
      tipo: "rotacionado";
      tokenAcesso: string;
      tokenAtualizacao: string;
      usuario: { id: string; nome: string; email: string; emailVerificado: boolean; papel: Papel; aplicacaoId: string };
      organizacaoId: string;
    };

function recusa(status: number, corpo: Record<string, unknown>): ResultadoRotacao {
  return { tipo: "recusa", status, corpo };
}

export async function rotacionarTokenAtualizacao(
  req: Request,
  tokenRecebido: string | undefined,
  opcoes: {
    // OpenID Connect: o token precisa ser de conta da aplicação que está
    // pedindo. Token de outra aplicação é só inválido — sem detecção de reuso
    // nem revogação, que são decisões sobre a sessão de outro cliente.
    aplicacaoId?: string;
  } = {},
): Promise<ResultadoRotacao> {
  const ip = obterIp(req);
  if (await limiteExcedido({ ip, evento: "atualizar_falha", maximo: MAX_FALHAS_ATUALIZAR })) {
    return recusa(429, { erro: "Muitas tentativas. Tente novamente mais tarde." });
  }

  // Token apresentado mas inválido/desconhecido/expirado — o sinal que o
  // rate limit acima conta. Só é chamado nos caminhos de token ruim, nunca
  // numa renovação bem-sucedida.
  const recusarTokenInvalido = async () => {
    await registrarEvento({ req, evento: "atualizar_falha" });
    await registrarTentativaIp({ ip, evento: "atualizar_falha", janelaMs: JANELA_ATUALIZAR_MS });
    return recusa(401, RESPOSTA_TOKEN_INVALIDO);
  };

  if (!tokenRecebido) {
    return recusa(401, { erro: "Token de atualização não informado." });
  }

  const payload = await verificarTokenAtualizacao(tokenRecebido);
  if (!payload) {
    return recusarTokenInvalido();
  }

  const registroToken = await prisma.tokenAtualizacao.findUnique({
    where: { tokenHash: hashToken(tokenRecebido) },
    // Só os campos que a rotação usa e devolve — nunca senhaHash/mfaSecret num
    // objeto que sai desta função.
    include: {
      usuario: {
        select: { id: true, nome: true, email: true, emailVerificado: true, papel: true, aplicacaoId: true },
      },
    },
  });

  if (!registroToken) {
    return recusarTokenInvalido();
  }
  if (opcoes.aplicacaoId && registroToken.usuario.aplicacaoId !== opcoes.aplicacaoId) {
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
    // Rotacionado agora há pouco: retentativa de uma resposta perdida, não
    // roubo (ver TOLERANCIA_REAPRESENTACAO_MS). Recusa sem contar no rate
    // limit — é o mesmo cliente legítimo, igual ao caminho de "perdeu a
    // corrida" lá embaixo.
    if (
      registroToken.revogadoMotivo === "rotacao" &&
      Date.now() - registroToken.revogadoEm.getTime() < TOLERANCIA_REAPRESENTACAO_MS
    ) {
      return recusa(401, RESPOSTA_TOKEN_INVALIDO);
    }
    // Revogado pela ROTAÇÃO e reapresentado depois da tolerância: o sinal
    // clássico de roubo. A rotação já emitiu um substituto, então só existem
    // duas explicações — o dono legítimo reusou uma cópia antiga por engano,
    // ou um atacante está com o token vazado. Não dá pra distinguir, então a
    // resposta segura é derrubar a família inteira (todas as sessões do
    // usuário). O motivo gravado é outro ("reuso_detectado"), senão cada
    // reapresentação de um desses tokens dispararia o alerta de novo.
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
      return recusa(401, RESPOSTA_TOKEN_INVALIDO);
    }
  } catch (erro) {
    console.error("Falha ao rotacionar token de atualização:", erro);
    return recusa(500, { erro: "Não foi possível renovar a sessão. Tente novamente." });
  }

  const novoTokenAcesso = await gerarTokenAcesso({
    sub: registroToken.usuario.id,
    email: registroToken.usuario.email,
    papel: registroToken.usuario.papel,
    aplicacaoId: registroToken.usuario.aplicacaoId,
    organizacaoId,
    papelOrganizacao: membro.papel,
  });

  return {
    tipo: "rotacionado",
    tokenAcesso: novoTokenAcesso,
    tokenAtualizacao: novoTokenAtualizacao,
    usuario: registroToken.usuario,
    organizacaoId,
  };
}
