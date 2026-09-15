import "server-only";

type EstadoSuspensao = { suspenso: boolean; suspensoAte: Date | null };
type DetalheSuspensao = { suspensoAte: Date | null; suspensoMotivo: string | null };

// Suspensão mora em Membro — vale dentro de UMA organização (ver
// prisma/schema.prisma). suspensoAte null + suspenso true = permanente.
// suspensoAte no passado é tratado como expirada — o acesso volta sozinho,
// sem precisar de reativação manual nem de job de limpeza.
export function estaSuspenso(membro: EstadoSuspensao): boolean {
  if (!membro.suspenso) return false;
  if (membro.suspensoAte && membro.suspensoAte.getTime() <= Date.now()) return false;
  return true;
}

// Mesmo critério de estaSuspenso, como filtro do Prisma sobre Membro: "não
// está suspenso AGORA". Precisa existir nas duas formas porque a escolha da
// organização de uma sessão nova é uma query (primeira acessível por
// criadoEm), não um filtro em memória.
export function filtroMembroNaoSuspenso() {
  return { OR: [{ suspenso: false }, { suspensoAte: { lte: new Date() } }] };
}

function descreverSuspensao({ suspensoAte, suspensoMotivo }: DetalheSuspensao) {
  const quando = suspensoAte
    ? ` até ${suspensoAte.toLocaleDateString("pt-BR")}`
    : " permanentemente";
  const motivo = suspensoMotivo ? ` Motivo: ${suspensoMotivo}` : "";
  return { quando, motivo };
}

// Login só é recusado quando a conta está suspensa em TODAS as organizações
// de que participa — com pelo menos uma acessível, a sessão abre nela. Com
// uma organização só, dá pra dizer até quando e por quê; com várias, cada
// suspensão tem seu prazo e seu motivo, e listar os de todas exporia a uma
// organização o que outra decidiu sobre a pessoa.
export function mensagemContaSuspensa(suspensoes: DetalheSuspensao[]): string {
  if (suspensoes.length === 1) {
    const { quando, motivo } = descreverSuspensao(suspensoes[0]);
    return `Esta conta foi suspensa${quando}.${motivo}`;
  }
  return "Esta conta está suspensa em todas as organizações de que participa.";
}

export function mensagemSuspensaoOrganizacao(membro: DetalheSuspensao): string {
  const { quando, motivo } = descreverSuspensao(membro);
  return `Seu acesso a esta organização foi suspenso${quando}.${motivo}`;
}
