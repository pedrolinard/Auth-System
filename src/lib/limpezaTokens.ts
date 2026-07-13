import "server-only";

import { prisma } from "@/lib/db";

const RETENCAO_REVOGADOS_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

// Remove tokens que não servem mais para nada: expirados, ou revogados há
// mais de RETENCAO_REVOGADOS_MS (a janela curta de retenção ajuda a
// depurar/auditar revogações recentes sem deixar a tabela crescer para sempre).
export async function limparTokensExpirados() {
  const agora = new Date();
  const limiteRevogados = new Date(agora.getTime() - RETENCAO_REVOGADOS_MS);

  const resultado = await prisma.tokenAtualizacao.deleteMany({
    where: {
      OR: [
        { expiraEm: { lt: agora } },
        { revogadoEm: { not: null, lt: limiteRevogados } },
      ],
    },
  });

  return resultado.count;
}
