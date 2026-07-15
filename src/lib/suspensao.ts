import "server-only";

// suspensoAte null + suspenso true = permanente. suspensoAte no passado é
// tratado como expirada — login volta a funcionar sozinho, sem precisar de
// reativação manual nem de job de limpeza.
export function estaSuspenso(usuario: { suspenso: boolean; suspensoAte: Date | null }): boolean {
  if (!usuario.suspenso) return false;
  if (usuario.suspensoAte && usuario.suspensoAte.getTime() <= Date.now()) return false;
  return true;
}

export function mensagemSuspensao(usuario: { suspensoAte: Date | null; suspensoMotivo: string | null }): string {
  const quando = usuario.suspensoAte
    ? ` até ${usuario.suspensoAte.toLocaleDateString("pt-BR")}`
    : " permanentemente";
  const motivo = usuario.suspensoMotivo ? ` Motivo: ${usuario.suspensoMotivo}` : "";
  return `Esta conta foi suspensa${quando}.${motivo}`;
}
