import "server-only";

import { prisma } from "@/lib/db";

const RETENCAO_REVOGADOS_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

// Retenção da trilha de auditoria (LGPD: guardar só "pelo tempo necessário").
// Um ano cobre investigação de incidente e a maior parte dos requisitos de
// conformidade; o rate limit e a detecção de dispositivo novo usam janelas
// muito mais curtas, então a poda não os afeta.
const RETENCAO_AUDITORIA_MS = 365 * 24 * 60 * 60 * 1000;

export type ResultadoLimpeza = {
  tokens: number;
  auditoria: number;
  desafiosMfa: number;
  limitesTaxa: number;
};

// Remove o que não serve mais para nada: tokens expirados ou revogados há
// mais de RETENCAO_REVOGADOS_MS, cookies de dispositivo confiável expirados,
// registros de auditoria além da janela de retenção, jtis de desafio MFA já
// expirados (não podem mais ser replayed de qualquer forma) e linhas do
// contador de rate limit cuja janela já fechou. Este último não afeta a
// CORREÇÃO do rate limit — uma chave expirada já é lida como zero (ver
// contar() em rateLimit.ts) e se resetada no próximo incrementar() — só
// existe pra a tabela não crescer sem limite com chaves mortas (ex.: um IP
// que errou a senha 5 vezes e nunca mais voltou).
export async function limparTokensExpirados(): Promise<ResultadoLimpeza> {
  const agora = new Date();
  const limiteRevogados = new Date(agora.getTime() - RETENCAO_REVOGADOS_MS);
  const limiteAuditoria = new Date(agora.getTime() - RETENCAO_AUDITORIA_MS);

  const tokens = await prisma.tokenAtualizacao.deleteMany({
    where: {
      OR: [
        { expiraEm: { lt: agora } },
        { revogadoEm: { not: null, lt: limiteRevogados } },
      ],
    },
  });

  // Mesma lógica de expiração dos tokens de atualização, aplicada aos
  // cookies de "dispositivo confiável" — sem TTL nem revogação parcial (só
  // existem "válido" ou "expirado"), então só a condição de expiraEm importa.
  await prisma.dispositivoConfiavel.deleteMany({ where: { expiraEm: { lt: agora } } });

  const auditoria = await prisma.logAuditoria.deleteMany({
    where: { criadoEm: { lt: limiteAuditoria } },
  });

  const desafiosMfa = await prisma.desafioMfaConsumido.deleteMany({
    where: { expiraEm: { lt: agora } },
  });

  const limitesTaxa = await prisma.limiteTaxa.deleteMany({
    where: { expiraEm: { lt: agora } },
  });

  // Códigos de autorização OIDC vivem 60 s. Guardados por um dia depois de
  // vencer: um código reapresentado nesse intervalo ainda é reconhecido como
  // "já usado" e derruba a sessão emitida com ele (ver src/lib/oidc.ts).
  await prisma.codigoAutorizacao.deleteMany({
    where: { expiraEm: { lt: new Date(agora.getTime() - 24 * 60 * 60 * 1000) } },
  });

  // Histórico de entregas de webhook: 30 dias bastam pro painel e pra
  // investigar uma integração; guardar pra sempre é só crescer a tabela.
  await prisma.entregaWebhook.deleteMany({
    where: { criadoEm: { lt: new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000) } },
  });

  // Convites de organização: o e-mail convidado não fica guardado para
  // sempre. Aceito, o convite já virou Membro e a linha não serve pra mais
  // nada (um link reaproveitado continua recusado: convite inexistente é
  // inválido). Pendente, o link vence em 7 dias (DURACAO_TOKEN_CONVITE_ORGANIZACAO);
  // passados 30 sem reenvio (reenviar renova criadoEm), sai da lista.
  await prisma.conviteOrganizacao.deleteMany({
    where: {
      OR: [
        { aceitoEm: { not: null } },
        { criadoEm: { lt: new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000) } },
      ],
    },
  });

  return {
    tokens: tokens.count,
    auditoria: auditoria.count,
    desafiosMfa: desafiosMfa.count,
    limitesTaxa: limitesTaxa.count,
  };
}
