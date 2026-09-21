import "server-only";

import { prisma } from "@/lib/db";
import { filtroMembroNaoSuspenso } from "@/lib/suspensao";
import type { PapelOrganizacao } from "@/lib/token";

// Substitui os checks inline `payload.papel !== "admin"` que existiam antes
// do multi-tenant (usuarios/route.ts, usuarios/[id]/suspender, .../reativar,
// .../route.ts DELETE) — o RBAC de "admin" nessas rotas passou a ser por
// ORGANIZAÇÃO (payload.papelOrganizacao: dono/admin/membro), não mais global.
// `payload.papel` (Papel de sistema: usuario/admin) continua existindo no
// token, mas nenhuma rota checa mais ele depois dessa mudança — ver
// PayloadTokenAcesso em token.ts.
export function temPapelOrganizacao(
  papelOrganizacao: PapelOrganizacao | undefined,
  permitidos: PapelOrganizacao[],
): boolean {
  return !!papelOrganizacao && permitidos.includes(papelOrganizacao);
}

// Confirma que um usuário-alvo é membro da MESMA organização de quem está
// agindo — sem essa checagem, um admin da organização A conseguiria
// suspender/remover/reativar qualquer usuário do sistema inteiro só sabendo
// o id, não só os da própria organização.
export async function obterMembroDaOrganizacao(organizacaoId: string, usuarioId: string) {
  return prisma.membro.findUnique({
    where: { organizacaoId_usuarioId: { organizacaoId, usuarioId } },
  });
}

// Hierarquia entre papéis ao agir sobre OUTRO membro (suspender, remover,
// mudar papel). Sem isso, um admin suspendia ou removia o dono — e o dono
// perdia o acesso à própria organização pelas mãos de quem ele mesmo
// promoveu. Dono age sobre todo mundo; admin, sobre admins e membros.
export function podeAgirSobre(papelAtor: PapelOrganizacao | undefined, papelAlvo: PapelOrganizacao) {
  if (papelAtor === "dono") return true;
  if (papelAtor === "admin") return papelAlvo !== "dono";
  return false;
}

// Sair ou excluir uma organização não pode deixar a pessoa sem nenhuma
// organização em que consiga entrar: a sessão precisa ser reemitida pra
// outra na hora, e resolverOrganizacaoAtiva (sessao.ts) lança erro quando
// todas estão suspensas.
export async function temOutraOrganizacaoAcessivel(usuarioId: string, organizacaoId: string) {
  const total = await prisma.membro.count({
    where: { usuarioId, organizacaoId: { not: organizacaoId }, ...filtroMembroNaoSuspenso() },
  });
  return total > 0;
}
