import "server-only";

import { prisma } from "@/lib/db";
import { gerarTokenServicoDominio } from "@/lib/token";

// Quantos alvos por chamada ao Django — o endpoint recusa listas maiores
// (django/tarefas/views_interno.py).
const LOTE = 100;
const TEMPO_LIMITE_MS = 8000;

type Transacao = Pick<typeof prisma, "exclusaoDominioPendente">;

const PREFIXO_ORGANIZACAO = "organizacao:";
const PREFIXO_USUARIO = "usuario:";

/**
 * Marca o que precisa sair do Django. Chamar DENTRO da transação que apaga a
 * conta e as organizações: ou as duas coisas acontecem, ou nenhuma — nunca
 * uma organização apagada sem o pedido de exclusão do outro lado.
 *
 * `usuarioId` cobre os projetos e tarefas LEGADOS da conta (de antes do
 * multi-tenant, sem organizacao_id), que a organização não alcança. Só vai na
 * exclusão da CONTA: excluir uma organização não pode levar junto os dados
 * legados de quem excluiu — a pessoa continua existindo.
 */
type DadosExclusao = { organizacoes: string[]; usuarioId?: string };

export function agendarExclusaoDominio(tx: Transacao, dados: DadosExclusao) {
  return tx.exclusaoDominioPendente.createMany({
    data: alvosDaExclusao(dados).map((alvo) => ({ alvo })),
    skipDuplicates: true,
  });
}

export function alvosDaExclusao(dados: DadosExclusao): string[] {
  return [
    ...dados.organizacoes.map((id) => `${PREFIXO_ORGANIZACAO}${id}`),
    ...(dados.usuarioId ? [`${PREFIXO_USUARIO}${dados.usuarioId}`] : []),
  ];
}

async function enviarLote(base: string, alvos: string[]): Promise<boolean> {
  const organizacoes = alvos.filter((a) => a.startsWith(PREFIXO_ORGANIZACAO)).map((a) => a.slice(PREFIXO_ORGANIZACAO.length));
  const usuarios = alvos.filter((a) => a.startsWith(PREFIXO_USUARIO)).map((a) => a.slice(PREFIXO_USUARIO.length));
  try {
    const token = await gerarTokenServicoDominio({ acao: "excluir_dados", organizacoes, usuarios });
    const resposta = await fetch(`${base}/api/dominio/interno/excluir-dados`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    if (!resposta.ok) throw new Error(`Django respondeu ${resposta.status}`);
    await prisma.exclusaoDominioPendente.deleteMany({ where: { alvo: { in: alvos } } });
    return true;
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.error("Falha ao excluir dados no Django:", mensagem);
    await prisma.exclusaoDominioPendente
      .updateMany({
        where: { alvo: { in: alvos } },
        data: { tentativas: { increment: 1 }, ultimoErro: mensagem.slice(0, 500) },
      })
      .catch(() => {});
    return false;
  }
}

/**
 * Pede ao Django a exclusão dos dados pendentes e tira da fila o que ele
 * confirmou, em lotes, até acabar ou até a primeira falha (com o Django fora
 * do ar não adianta insistir agora). Best-effort: nunca lança. Chamado logo
 * depois da exclusão da conta (pra quase sempre resolver na hora) e pelo job
 * de limpeza (pro que falhou).
 *
 * Sem DJANGO_SERVICE_URL não há pra quem pedir: a fila fica esperando.
 */
export async function processarExclusoesDominio(
  somente?: string[],
): Promise<{ excluidas: number; falhas: number }> {
  const base = process.env.DJANGO_SERVICE_URL?.replace(/\/+$/, "");
  if (!base) return { excluidas: 0, falhas: 0 };

  let excluidas = 0;
  const tentados = new Set<string>();
  for (;;) {
    const pendentes = await prisma.exclusaoDominioPendente.findMany({
      where: {
        ...(somente ? { alvo: { in: somente } } : {}),
        // Nunca reenvia na mesma rodada o que já foi tentado: sem isso, um
        // lote que o Django aceitasse mas cuja remoção da fila falhasse
        // viraria laço infinito.
        ...(tentados.size > 0 ? { NOT: { alvo: { in: [...tentados] } } } : {}),
      },
      orderBy: { criadoEm: "asc" },
      take: LOTE,
      select: { alvo: true },
    });
    if (pendentes.length === 0) return { excluidas, falhas: 0 };

    const alvos = pendentes.map((p) => p.alvo);
    alvos.forEach((a) => tentados.add(a));
    if (!(await enviarLote(base, alvos))) return { excluidas, falhas: alvos.length };
    excluidas += alvos.length;
  }
}
