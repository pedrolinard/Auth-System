import "server-only";

import { Resend } from "resend";

// Sem RESEND_API_KEY (dev local sem provedor configurado): cai de volta pro
// link no console, mesmo comportamento de antes. Em produção, com a chave
// configurada, envia de verdade.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// onboarding@resend.dev é o domínio de teste do Resend — funciona sem
// verificação de DNS, mas só entrega pro e-mail cadastrado na conta Resend
// (limitação do modo sandbox). Pra enviar pra qualquer destinatário, é
// preciso verificar um domínio próprio e trocar EMAIL_FROM.
const REMETENTE = process.env.EMAIL_FROM ?? "onboarding@resend.dev";

export async function enviarEmailVerificacao(destinatario: string, link: string) {
  if (!resend) {
    console.log(`[dev] Link de verificação de e-mail para ${destinatario}: ${link}`);
    return;
  }

  const { error } = await resend.emails.send({
    from: REMETENTE,
    to: destinatario,
    subject: "Confirme seu e-mail",
    html: `
      <p>Confirme seu e-mail pra ativar sua conta.</p>
      <p><a href="${link}">${link}</a></p>
      <p style="color:#71717a;font-size:12px">Se você não criou essa conta, pode ignorar este e-mail.</p>
    `,
  });

  // Best-effort: uma falha no envio não deve impedir o cadastro em si (o
  // usuário já foi criado; o link continua válido, só não chegou por e-mail).
  if (error) {
    console.error("Falha ao enviar e-mail de verificação:", error);
  }
}

export async function enviarEmailRedefinicaoSenha(destinatario: string, link: string) {
  if (!resend) {
    console.log(`[dev] Link de redefinição de senha para ${destinatario}: ${link}`);
    return;
  }

  const { error } = await resend.emails.send({
    from: REMETENTE,
    to: destinatario,
    subject: "Redefinição de senha",
    html: `
      <p>Pediram a redefinição da senha desta conta. Clique no link abaixo pra escolher uma nova senha:</p>
      <p><a href="${link}">${link}</a></p>
      <p style="color:#71717a;font-size:12px">O link expira em 1 hora. Se você não pediu isso, pode ignorar este e-mail — sua senha continua a mesma.</p>
    `,
  });

  // Best-effort, mesmo raciocínio do envio de verificação: falha no envio não
  // deve estourar a resposta genérica da rota (que já não revela se o
  // e-mail existe ou não).
  if (error) {
    console.error("Falha ao enviar e-mail de redefinição de senha:", error);
  }
}
