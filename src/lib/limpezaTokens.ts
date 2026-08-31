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
};

// Remove o que não serve mais para nada: tokens expirados ou revogados há
// mais de RETENCAO_REVOGADOS_MS, cookies de dispositivo confiável expirados,
// registros de auditoria além da janela de retenção e jtis de desafio MFA já
// expirados (não podem mais ser replayed de qualquer forma).
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

  return {
    tokens: tokens.count,
    auditoria: auditoria.count,
    desafiosMfa: desafiosMfa.count,
  };
}
