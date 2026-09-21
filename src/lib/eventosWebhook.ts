// Eventos que um webhook de aplicação pode assinar. Arquivo sem dependências
// de propósito: a validação (validacao.ts) e o painel usam a lista sem puxar
// banco nem rede.
export const EVENTOS_WEBHOOK = [
  "usuario.criado",
  "usuario.email_verificado",
  "usuario.email_alterado",
  "usuario.senha_alterada",
  "usuario.mfa_ativado",
  "usuario.mfa_desativado",
  "usuario.excluido",
  "membro.suspenso",
  "membro.reativado",
  "membro.removido",
  "membro.papel_alterado",
  "membro.saiu",
  "organizacao.renomeada",
  "organizacao.transferida",
  "organizacao.excluida",
] as const;

export type EventoWebhook = (typeof EVENTOS_WEBHOOK)[number] | "webhook.teste";
