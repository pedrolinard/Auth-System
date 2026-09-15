import "server-only";

import { prisma } from "@/lib/db";
import { gerarTokenServicoDominio } from "@/lib/token";

// Quantas organizações por chamada ao Django — o endpoint recusa listas
// maiores (django/tarefas/views_interno.py).
const LOTE = 100;
const TEMPO_LIMITE_MS = 8000;

type Transacao = Pick<typeof prisma, "exclusaoDominioPendente">;

/**
 * Marca organizações cujos projetos e tarefas no Django precisam sair. Chamar
 * DENTRO da transação que apaga as organizações: ou as duas coisas acontecem,
 * ou nenhuma — nunca uma organização apagada sem o pedido de exclusão do
 * outro lado.
 */
export function agendarExclusaoDominio(tx: Transacao, organizacoes: string[]) {
  return tx.exclusaoDominioPendente.createMany({
    data: organizacoes.map((organizacaoId) => ({ organizacaoId })),
    skipDuplicates: true,
  });
}

/**
 * Pede ao Django a exclusão dos dados das organizações pendentes e tira da
 * fila as que ele confirmou. Best-effort: nunca lança. Chamado logo depois da
 * exclusão da conta (pra na maioria das vezes resolver na hora) e pelo job de
 * limpeza (pra o que falhou por o Django estar fora do ar).
 *
 * Sem DJANGO_SERVICE_URL não há pra quem pedir: a fila fica esperando.
 */
export async function processarExclusoesDominio(
  somente?: string[],
): Promise<{ excluidas: number; falhas: number }> {
  const base = process.env.DJANGO_SERVICE_URL?.replace(/\/+$/, "");
  if (!base) return { excluidas: 0, falhas: 0 };

  const pendentes = await prisma.exclusaoDominioPendente.findMany({
    where: somente ? { organizacaoId: { in: somente } } : {},
    orderBy: { criadoEm: "asc" },
    take: LOTE,
    select: { organizacaoId: true },
  });
  if (pendentes.length === 0) return { excluidas: 0, falhas: 0 };
  const organizacoes = pendentes.map((p) => p.organizacaoId);

  try {
    const token = await gerarTokenServicoDominio({ acao: "excluir_organizacoes", organizacoes });
    const resposta = await fetch(`${base}/api/dominio/interno/excluir-organizacoes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ organizacoes }),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    if (!resposta.ok) throw new Error(`Django respondeu ${resposta.status}`);
    await prisma.exclusaoDominioPendente.deleteMany({ where: { organizacaoId: { in: organizacoes } } });
    return { excluidas: organizacoes.length, falhas: 0 };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.error("Falha ao excluir dados de organizações no Django:", mensagem);
    await prisma.exclusaoDominioPendente
      .updateMany({
        where: { organizacaoId: { in: organizacoes } },
        data: { tentativas: { increment: 1 }, ultimoErro: mensagem.slice(0, 500) },
      })
      .catch(() => {});
    return { excluidas: 0, falhas: organizacoes.length };
  }
}
