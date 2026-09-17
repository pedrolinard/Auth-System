// Por que uma sessão (TokenAtualizacao) foi revogada.
//
// Existe por causa da detecção de reuso de refresh token (atualizar/route.ts):
// um token revogado sendo reapresentado só é sinal de roubo quando ele foi
// revogado pela ROTAÇÃO — aí já existe um substituto emitido, e alguém está
// usando a cópia antiga. Em qualquer outro motivo, reapresentar é o esperado:
// o navegador da pessoa não tem como saber que o admin a suspendeu, que ela
// trocou a senha em outro aparelho ou que a sessão caiu pelo limite de 5.
// Tratar esses casos como roubo derrubava todas as sessões dela e mandava um
// e-mail de "atividade suspeita" pra quem não fez nada de errado.
export type MotivoRevogacao =
  | "rotacao"
  | "reuso_detectado"
  | "logout"
  | "sessao_encerrada"
  | "todas_sessoes_encerradas"
  | "limite_sessoes"
  | "senha_alterada"
  | "senha_redefinida"
  | "email_alterado"
  | "suspensao"
  | "remocao_organizacao"
  | "saida_organizacao"
  | "aplicacao_desativada";

export function revogacao(motivo: MotivoRevogacao) {
  return { revogadoEm: new Date(), revogadoMotivo: motivo };
}

// Token revogado ANTES da coluna existir não tem motivo. Trata como rotação:
// na janela do deploy, perder a detecção de roubo de verdade é pior que um
// alarme falso eventual — e esses tokens expiram sozinhos em até 30 dias.
export function revogacaoIndicaRoubo(motivo: string | null): boolean {
  return motivo === null || motivo === "rotacao";
}
