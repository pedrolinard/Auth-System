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

const RODAPE_PADRAO =
  '<p style="color:#71717a;font-size:12px">Este é um e-mail automático de segurança da sua conta.</p>';

// IP e User-Agent vêm direto da requisição (o segundo é 100% controlado pelo
// cliente) e são interpolados no HTML do e-mail — sem escapar, um User-Agent
// forjado com marcação HTML/JS injetaria conteúdo arbitrário no e-mail
// recebido pelo usuário.
function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function enviarEmailVerificacao(destinatario: string, link: string) {
  if (!resend) {
    console.log(`[dev] Link de verificação de e-mail para ${destinatario}: ${link}`);
    return;
  }

  try {
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
  } catch (erro) {
    console.error("Falha ao enviar e-mail de verificação:", erro);
  }
}

export async function enviarEmailRedefinicaoSenha(destinatario: string, link: string) {
  if (!resend) {
    console.log(`[dev] Link de redefinição de senha para ${destinatario}: ${link}`);
    return;
  }

  try {
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
  } catch (erro) {
    console.error("Falha ao enviar e-mail de redefinição de senha:", erro);
  }
}

export async function enviarEmailConviteOrganizacao(
  destinatario: string,
  link: string,
  dados: { organizacaoNome: string; convidadoPorNome: string },
) {
  const organizacaoNome = escaparHtml(dados.organizacaoNome);
  const convidadoPorNome = escaparHtml(dados.convidadoPorNome);

  if (!resend) {
    console.log(
      `[dev] Convite de ${convidadoPorNome} para ${destinatario} entrar em "${organizacaoNome}": ${link}`,
    );
    return;
  }

  try {
    const { error } = await resend.emails.send({
      from: REMETENTE,
      to: destinatario,
      subject: `${convidadoPorNome} te convidou para "${organizacaoNome}"`,
      html: `
        <p><strong>${convidadoPorNome}</strong> te convidou para entrar na organização <strong>${organizacaoNome}</strong>.</p>
        <p><a href="${link}">${link}</a></p>
        <p style="color:#71717a;font-size:12px">O link expira em 7 dias. Se você não esperava este convite, pode ignorar este e-mail.</p>
      `,
    });

    // Best-effort, mesmo raciocínio dos outros links por e-mail: uma falha
    // aqui não deve estourar a resposta da rota (o convite já foi criado, só
    // não chegou por e-mail).
    if (error) {
      console.error("Falha ao enviar e-mail de convite de organização:", error);
    }
  } catch (erro) {
    console.error("Falha ao enviar e-mail de convite de organização:", erro);
  }
}

// Notificações de segurança abaixo: nenhuma delas pode derrubar o fluxo
// principal (login, MFA, troca de senha) — todas seguem o mesmo padrão
// best-effort (try/catch + log) das duas funções acima, mesmo sem link
// nenhum pra clicar (são só avisos).

export async function enviarEmailDispositivoNovo(
  destinatario: string,
  dados: { ip: string | null; userAgent: string | null; quando: Date },
) {
  const quando = dados.quando.toLocaleString("pt-BR");
  const ip = escaparHtml(dados.ip ?? "desconhecido");
  const userAgent = escaparHtml(dados.userAgent ?? "desconhecido");

  if (!resend) {
    console.log(`[dev] Alerta de login em novo dispositivo para ${destinatario} (IP ${ip})`);
    return;
  }

  try {
    const { error } = await resend.emails.send({
      from: REMETENTE,
      to: destinatario,
      subject: "Novo login detectado na sua conta",
      html: `
        <p>Detectamos um login na sua conta a partir de um dispositivo ou local que não reconhecemos.</p>
        <ul>
          <li><strong>Quando:</strong> ${quando}</li>
          <li><strong>IP:</strong> ${ip}</li>
          <li><strong>Dispositivo:</strong> ${userAgent}</li>
        </ul>
        <p>Se foi você, pode ignorar este e-mail. Se não foi, troque sua senha agora e revise as sessões ativas na sua conta.</p>
        ${RODAPE_PADRAO}
      `,
    });
    if (error) console.error("Falha ao enviar e-mail de novo dispositivo:", error);
  } catch (erro) {
    console.error("Falha ao enviar e-mail de novo dispositivo:", erro);
  }
}

export async function enviarEmailMfaAtivado(destinatario: string) {
  if (!resend) {
    console.log(`[dev] Aviso de MFA ativado para ${destinatario}`);
    return;
  }

  try {
    const { error } = await resend.emails.send({
      from: REMETENTE,
      to: destinatario,
      subject: "Verificação em duas etapas ativada",
      html: `
        <p>A verificação em duas etapas (MFA) foi ativada na sua conta.</p>
        <p>Se não foi você, entre na sua conta agora, desative o MFA e troque sua senha.</p>
        ${RODAPE_PADRAO}
      `,
    });
    if (error) console.error("Falha ao enviar e-mail de MFA ativado:", error);
  } catch (erro) {
    console.error("Falha ao enviar e-mail de MFA ativado:", erro);
  }
}

export async function enviarEmailMfaDesativado(destinatario: string) {
  if (!resend) {
    console.log(`[dev] Aviso de MFA desativado para ${destinatario}`);
    return;
  }

  try {
    const { error } = await resend.emails.send({
      from: REMETENTE,
      to: destinatario,
      subject: "Verificação em duas etapas desativada",
      html: `
        <p>A verificação em duas etapas (MFA) foi desativada na sua conta — a partir de agora, só a sua senha protege o acesso.</p>
        <p>Se não foi você, reative o MFA e troque sua senha imediatamente.</p>
        ${RODAPE_PADRAO}
      `,
    });
    if (error) console.error("Falha ao enviar e-mail de MFA desativado:", error);
  } catch (erro) {
    console.error("Falha ao enviar e-mail de MFA desativado:", erro);
  }
}

export async function enviarEmailSenhaAlterada(destinatario: string) {
  if (!resend) {
    console.log(`[dev] Aviso de senha alterada para ${destinatario}`);
    return;
  }

  try {
    const { error } = await resend.emails.send({
      from: REMETENTE,
      to: destinatario,
      subject: "Sua senha foi alterada",
      html: `
        <p>A senha da sua conta foi alterada. Todas as sessões ativas foram encerradas por segurança.</p>
        <p>Se não foi você, use a opção "Esqueci minha senha" para recuperar o acesso agora.</p>
        ${RODAPE_PADRAO}
      `,
    });
    if (error) console.error("Falha ao enviar e-mail de senha alterada:", error);
  } catch (erro) {
    console.error("Falha ao enviar e-mail de senha alterada:", erro);
  }
}

export async function enviarEmailCodigosBackupRegenerados(destinatario: string) {
  if (!resend) {
    console.log(`[dev] Aviso de códigos de backup regenerados para ${destinatario}`);
    return;
  }

  try {
    const { error } = await resend.emails.send({
      from: REMETENTE,
      to: destinatario,
      subject: "Códigos de backup de MFA regenerados",
      html: `
        <p>Um novo conjunto de códigos de backup foi gerado para a verificação em duas etapas da sua conta — os códigos antigos não funcionam mais.</p>
        <p>Se não foi você, troque sua senha e revise se o MFA continua configurado do jeito que você espera.</p>
        ${RODAPE_PADRAO}
      `,
    });
    if (error) console.error("Falha ao enviar e-mail de códigos de backup regenerados:", error);
  } catch (erro) {
    console.error("Falha ao enviar e-mail de códigos de backup regenerados:", erro);
  }
}

export async function enviarEmailConfirmacaoAlteracaoEmail(destinatario: string, link: string) {
  if (!resend) {
    console.log(`[dev] Link de confirmação de alteração de e-mail para ${destinatario}: ${link}`);
    return;
  }

  try {
    const { error } = await resend.emails.send({
      from: REMETENTE,
      to: destinatario,
      subject: "Confirme seu novo e-mail",
      html: `
        <p>Pediram a troca do e-mail desta conta para este endereço. Clique no link
        abaixo para confirmar — o e-mail da conta só muda depois dessa confirmação:</p>
        <p><a href="${link}">${link}</a></p>
        <p style="color:#71717a;font-size:12px">O link expira em 1 hora. Se você não pediu essa troca, pode ignorar este e-mail.</p>
      `,
    });
    if (error) console.error("Falha ao enviar e-mail de confirmação de alteração de e-mail:", error);
  } catch (erro) {
    console.error("Falha ao enviar e-mail de confirmação de alteração de e-mail:", erro);
  }
}

// Aviso pro e-mail ANTIGO no momento em que a troca é PEDIDA (antes da
// confirmação) — sem isso, um pedido feito com sessão roubada só apareceria
// pro dono depois de concluído. Aqui ele tem a chance de reagir (trocar a
// senha, revisar sessões) enquanto o link de confirmação ainda não foi
// clicado.
export async function enviarEmailAlteracaoEmailSolicitada(
  destinatarioAntigo: string,
  novoEmail: string,
) {
  const novoEmailEscapado = escaparHtml(novoEmail);

  if (!resend) {
    console.log(
      `[dev] Aviso de troca de e-mail SOLICITADA para ${destinatarioAntigo} (novo: ${novoEmailEscapado})`,
    );
    return;
  }

  try {
    const { error } = await resend.emails.send({
      from: REMETENTE,
      to: destinatarioAntigo,
      subject: "Pediram para trocar o e-mail da sua conta",
      html: `
        <p>Alguém pediu para trocar o e-mail desta conta para <strong>${novoEmailEscapado}</strong>.
        A troca só acontece quando o link enviado para o novo endereço for confirmado.</p>
        <p>Se foi você, pode ignorar este aviso. <strong>Se não foi</strong>, troque sua senha agora
        e revise as sessões ativas — sua conta pode estar comprometida.</p>
        ${RODAPE_PADRAO}
      `,
    });
    if (error) console.error("Falha ao enviar aviso de troca de e-mail solicitada:", error);
  } catch (erro) {
    console.error("Falha ao enviar aviso de troca de e-mail solicitada:", erro);
  }
}

export async function enviarEmailEmailAlterado(destinatarioAntigo: string, novoEmail: string) {
  const novoEmailEscapado = escaparHtml(novoEmail);

  if (!resend) {
    console.log(`[dev] Aviso de e-mail alterado para ${destinatarioAntigo} (novo: ${novoEmailEscapado})`);
    return;
  }

  try {
    const { error } = await resend.emails.send({
      from: REMETENTE,
      to: destinatarioAntigo,
      subject: "O e-mail da sua conta foi alterado",
      html: `
        <p>O e-mail desta conta foi trocado para <strong>${novoEmailEscapado}</strong>.</p>
        <p>Se não foi você, alguém pode ter acesso à sua conta — troque sua senha imediatamente e revise as sessões ativas.</p>
        ${RODAPE_PADRAO}
      `,
    });
    if (error) console.error("Falha ao enviar e-mail de alerta de alteração de e-mail:", error);
  } catch (erro) {
    console.error("Falha ao enviar e-mail de alerta de alteração de e-mail:", erro);
  }
}

export async function enviarEmailViagemImpossivel(
  destinatario: string,
  dados: { paisAnterior: string; paisAtual: string; quando: Date },
) {
  const quando = dados.quando.toLocaleString("pt-BR");
  const paisAnterior = escaparHtml(dados.paisAnterior);
  const paisAtual = escaparHtml(dados.paisAtual);

  if (!resend) {
    console.log(
      `[dev] Alerta de viagem impossível para ${destinatario} (${paisAnterior} -> ${paisAtual})`,
    );
    return;
  }

  try {
    const { error } = await resend.emails.send({
      from: REMETENTE,
      to: destinatario,
      subject: "Login suspeito: locais incompatíveis detectados",
      html: `
        <p>Sua conta acabou de ser acessada de <strong>${paisAtual}</strong>, pouco tempo depois de
        um acesso de <strong>${paisAnterior}</strong> — distância improvável de percorrer nesse
        intervalo (${quando}).</p>
        <p>Se foi você (ex.: usando uma VPN), pode ignorar este e-mail. Se não foi, troque sua
        senha agora e revise as sessões ativas na sua conta.</p>
        ${RODAPE_PADRAO}
      `,
    });
    if (error) console.error("Falha ao enviar e-mail de viagem impossível:", error);
  } catch (erro) {
    console.error("Falha ao enviar e-mail de viagem impossível:", erro);
  }
}

export async function enviarEmailPasskeyAlterada(
  destinatario: string,
  acao: "adicionada" | "removida",
) {
  if (!resend) {
    console.log(`[dev] Aviso de passkey ${acao} para ${destinatario}`);
    return;
  }

  try {
    const { error } = await resend.emails.send({
      from: REMETENTE,
      to: destinatario,
      subject: acao === "adicionada" ? "Nova passkey adicionada" : "Passkey removida",
      html: `
        <p>Uma passkey foi ${acao} na sua conta.</p>
        <p>Se não foi você, revise as passkeys e sessões ativas da sua conta e troque sua senha.</p>
        ${RODAPE_PADRAO}
      `,
    });
    if (error) console.error(`Falha ao enviar e-mail de passkey ${acao}:`, error);
  } catch (erro) {
    console.error(`Falha ao enviar e-mail de passkey ${acao}:`, erro);
  }
}

export async function enviarEmailContaExcluida(destinatario: string) {
  if (!resend) {
    console.log(`[dev] Confirmação de conta excluída para ${destinatario}`);
    return;
  }

  try {
    const { error } = await resend.emails.send({
      from: REMETENTE,
      to: destinatario,
      subject: "Sua conta foi excluída",
      html: `
        <p>Confirmamos a exclusão permanente da sua conta e de todos os dados associados a ela (sessões, MFA, dispositivos confiáveis).</p>
        <p>Se você não pediu essa exclusão, entre em contato com o suporte imediatamente — não é possível desfazer essa ação sozinho, já que a conta não existe mais para fazer login.</p>
        ${RODAPE_PADRAO}
      `,
    });
    if (error) console.error("Falha ao enviar e-mail de confirmação de exclusão de conta:", error);
  } catch (erro) {
    console.error("Falha ao enviar e-mail de confirmação de exclusão de conta:", erro);
  }
}

export async function enviarEmailReusoTokenDetectado(destinatario: string) {
  if (!resend) {
    console.log(`[dev] Alerta de reuso de token detectado para ${destinatario}`);
    return;
  }

  try {
    const { error } = await resend.emails.send({
      from: REMETENTE,
      to: destinatario,
      subject: "Atividade suspeita: todas as sessões foram encerradas",
      html: `
        <p>Detectamos o reuso de um token de sessão que já tinha sido substituído — um sinal clássico de que alguém mais pode ter tido acesso a uma sessão sua.</p>
        <p>Por segurança, <strong>todas as suas sessões ativas foram encerradas</strong> automaticamente (inclusive a sua, se estiver com alguma aba aberta agora).</p>
        <p>Se não foi você, troque sua senha assim que possível.</p>
        ${RODAPE_PADRAO}
      `,
    });
    if (error) console.error("Falha ao enviar e-mail de alerta de reuso de token:", error);
  } catch (erro) {
    console.error("Falha ao enviar e-mail de alerta de reuso de token:", erro);
  }
}
