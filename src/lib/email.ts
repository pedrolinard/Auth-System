import "server-only";

import { Resend } from "resend";

import { prisma } from "@/lib/db";
import { consumirCota } from "@/lib/rateLimit";

// Sem RESEND_API_KEY (dev local sem provedor configurado): cai de volta pro
// link no console, mesmo comportamento de antes. Em produção, com a chave
// configurada, envia de verdade.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// onboarding@resend.dev é o domínio de teste do Resend — funciona sem
// verificação de DNS, mas só entrega pro e-mail cadastrado na conta Resend
// (limitação do modo sandbox). Pra enviar pra qualquer destinatário, é
// preciso verificar um domínio próprio e trocar EMAIL_FROM.
const REMETENTE = process.env.EMAIL_FROM ?? "onboarding@resend.dev";

// A marca da aplicação cliente dona da conta. Um usuário final do cliente
// "Acme" não conhece este provedor: um e-mail de "Auth Gateway" pedindo pra
// ele confirmar o e-mail ou avisando de login novo parece phishing. Com a
// marca, o assunto e o cabeçalho levam o nome da aplicação e, se o cliente
// tiver um remetente verificado no Resend, sai dele. `null` = aplicação
// padrão (o próprio painel), comportamento de sempre.
export type MarcaEmail = {
  aplicacaoId: string;
  nome: string;
  // Aprovada por quem opera o provedor (Aplicacao.aprovada). Sem aprovação o
  // nome não vai no assunto e o e-mail diz com todas as letras que é o
  // provedor escrevendo em nome de um aplicativo não verificado.
  verificada: boolean;
  remetente: string | null;
  logoUrl: string | null;
} | null;

const NOME_PROVEDOR = process.env.PASSKEY_RP_NAME ?? "Auth Gateway";

// Cota de e-mails por aplicação cliente, por hora, independente de IP: o
// limite por IP das rotas não pega um backend que muda de IP (ou uma conta
// que chama o cadastro com milhares de endereços de terceiros). Aplicação
// ainda não aprovada tem cota curta.
const JANELA_COTA_EMAIL_MS = 60 * 60 * 1000;
export const COTA_EMAIL_POR_HORA = { verificada: 1000, naoVerificada: 30 };

// IP, User-Agent, nomes digitados por usuários e a própria marca vão
// interpolados no HTML do e-mail — sem escapar, um User-Agent forjado com
// marcação HTML/JS injetaria conteúdo arbitrário no e-mail recebido.
function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ESTILO_NOTA = 'style="color:#71717a;font-size:12px"';

function rodape(marca: MarcaEmail) {
  const conta = marca ? ` em ${escaparHtml(marca.nome)}` : "";
  return `<p ${ESTILO_NOTA}>Este é um e-mail automático de segurança da sua conta${conta}.</p>`;
}

function cabecalhoMarca(marca: MarcaEmail) {
  if (!marca) return "";
  const logo = marca.logoUrl
    ? `<img src="${escaparHtml(marca.logoUrl)}" alt="" height="32" style="display:block;margin-bottom:8px">`
    : "";
  const via = marca.verificada
    ? ""
    : ` <span style="font-weight:400;color:#71717a">via ${escaparHtml(NOME_PROVEDOR)}</span>`;
  return `${logo}<p style="font-weight:600;margin:0 0 12px">${escaparHtml(marca.nome)}${via}</p>`;
}

// Quem manda de verdade, em todo e-mail de aplicação cliente — o usuário
// final precisa conseguir distinguir o aplicativo do provedor que envia.
function notaEmNomeDe(marca: MarcaEmail) {
  if (!marca) return "";
  const aviso = marca.verificada
    ? ""
    : ` ${escaparHtml(NOME_PROVEDOR)} ainda não verificou este aplicativo: desconfie de pedidos de senha ou pagamento.`;
  return `<p ${ESTILO_NOTA}>Enviado por ${escaparHtml(NOME_PROVEDOR)} em nome de ${escaparHtml(marca.nome)}.${aviso}</p>`;
}

// O login não exige e-mail verificado: sem esta checagem, bastava cadastrar
// contas com endereços de terceiros, entrar com a senha escolhida e disparar
// alertas (MFA ativado, senha alterada...) em laço, fora da cota. Um alerta só
// fica fora dela quando o endereço já provou ser de quem tem a conta.
async function destinatarioVerificado(aplicacaoId: string, email: string): Promise<boolean> {
  const conta = await prisma.usuario.findFirst({
    where: { aplicacaoId, email: email.toLowerCase(), emailVerificado: true },
    select: { id: true },
  });
  return conta !== null;
}

async function dentroDaCota(marca: NonNullable<MarcaEmail>): Promise<boolean> {
  return consumirCota({
    chave: `cota_email:${marca.aplicacaoId}`,
    maximo: marca.verificada ? COTA_EMAIL_POR_HORA.verificada : COTA_EMAIL_POR_HORA.naoVerificada,
    janelaMs: JANELA_COTA_EMAIL_MS,
  });
}

// Todo envio passa por aqui: aplica a marca, e é best-effort — uma falha no
// provedor de e-mail (erro retornado OU exceção de rede) só é logada, nunca
// derruba o fluxo principal (cadastro, login, troca de senha). O usuário já
// foi criado / a senha já mudou; só o aviso não chegou.
async function enviar(dados: {
  destinatario: string;
  assunto: string;
  corpoHtml: string;
  marca: MarcaEmail;
  // O que aparece no console em dev e nos logs de falha.
  descricao: string;
  logDev?: string;
  // Endereço que QUEM FAZ A REQUISIÇÃO escolhe (verificação, redefinição,
  // convite, confirmação de troca de e-mail, aviso de cadastro existente): é
  // o que dá pra usar pra mandar e-mail a terceiros, então conta na cota.
  // Os alertas de segurança vão pro dono da conta e nascem de eventos dela —
  // ficam FORA da cota, senão quem gastasse a cota com cadastros falsos
  // calaria "sua senha foi alterada" e "reuso de token detectado". Mas só
  // quando o endereço é de uma conta VERIFICADA (ver destinatarioVerificado).
  contaNaCota?: boolean;
}) {
  const { destinatario, assunto, corpoHtml, marca, descricao } = dados;

  try {
    const naCota = marca && (dados.contaNaCota || !(await destinatarioVerificado(marca.aplicacaoId, destinatario)));
    if (marca && naCota && !(await dentroDaCota(marca))) {
      console.warn(`Cota de e-mails da aplicação ${marca.aplicacaoId} esgotada: ${descricao} não enviado.`);
      return;
    }
  } catch (erro) {
    // Sem conseguir contar, não envia: a cota existe justamente pra conter
    // abuso, e falhar aberto aqui a desligaria.
    console.error("Falha ao conferir a cota de e-mails:", erro);
    return;
  }

  if (!resend) {
    console.log(`[dev] ${dados.logDev ?? descricao} para ${destinatario}`);
    return;
  }

  try {
    const { error } = await resend.emails.send({
      // Nome de exibição sem <, >, aspas ou quebra de linha: são os
      // caracteres que desmontariam o header From ("Nome <email>").
      from: marca?.remetente
        ? `${marca.nome.replace(/[<>"\r\n]/g, "")} <${marca.remetente}>`
        : REMETENTE,
      to: destinatario,
      // Nome do aplicativo no assunto só com aprovação: no assunto não cabe o
      // "em nome de", e é ali que um phishing se apresenta.
      subject: marca?.verificada ? `${marca.nome}: ${assunto}` : assunto,
      html: `${cabecalhoMarca(marca)}${corpoHtml}${notaEmNomeDe(marca)}`,
    });
    if (error) console.error(`Falha ao enviar e-mail (${descricao}):`, error);
  } catch (erro) {
    console.error(`Falha ao enviar e-mail (${descricao}):`, erro);
  }
}

export async function enviarEmailVerificacao(destinatario: string, link: string, marca: MarcaEmail = null) {
  await enviar({
    destinatario,
    marca,
    descricao: "verificação de e-mail",
    contaNaCota: true,
    logDev: `Link de verificação de e-mail: ${link}`,
    assunto: "Confirme seu e-mail",
    corpoHtml: `
      <p>Confirme seu e-mail pra ativar sua conta.</p>
      <p><a href="${link}">${link}</a></p>
      <p ${ESTILO_NOTA}>Se você não criou essa conta, pode ignorar este e-mail.</p>
    `,
  });
}

export async function enviarEmailRedefinicaoSenha(destinatario: string, link: string, marca: MarcaEmail = null) {
  await enviar({
    destinatario,
    marca,
    descricao: "redefinição de senha",
    contaNaCota: true,
    logDev: `Link de redefinição de senha: ${link}`,
    assunto: "Redefinição de senha",
    corpoHtml: `
      <p>Pediram a redefinição da senha desta conta. Clique no link abaixo pra escolher uma nova senha:</p>
      <p><a href="${link}">${link}</a></p>
      <p ${ESTILO_NOTA}>O link expira em 1 hora. Se você não pediu isso, pode ignorar este e-mail — sua senha continua a mesma.</p>
    `,
  });
}

export async function enviarEmailConviteOrganizacao(
  destinatario: string,
  link: string,
  dados: { organizacaoNome: string; convidadoPorNome: string },
  marca: MarcaEmail = null,
) {
  const organizacaoNome = escaparHtml(dados.organizacaoNome);
  const convidadoPorNome = escaparHtml(dados.convidadoPorNome);
  await enviar({
    destinatario,
    marca,
    descricao: "convite de organização",
    contaNaCota: true,
    logDev: `Convite de ${dados.convidadoPorNome} para entrar em "${dados.organizacaoNome}": ${link}`,
    // Assunto não é HTML: vai o nome cru. Escapado, um "&" no nome da
    // organização aparecia como "&amp;" na caixa de entrada.
    assunto: `${dados.convidadoPorNome} te convidou para "${dados.organizacaoNome}"`,
    corpoHtml: `
      <p><strong>${convidadoPorNome}</strong> te convidou para entrar na organização <strong>${organizacaoNome}</strong>.</p>
      <p><a href="${link}">${link}</a></p>
      <p ${ESTILO_NOTA}>O link expira em 7 dias. Se você não esperava este convite, pode ignorar este e-mail.</p>
    `,
  });
}

// Notificações de segurança abaixo: nenhuma tem link pra clicar, são só
// avisos — e todas passam pelo mesmo envio best-effort.

export async function enviarEmailDispositivoNovo(
  destinatario: string,
  dados: { ip: string | null; userAgent: string | null; quando: Date },
  marca: MarcaEmail = null,
) {
  const quando = dados.quando.toLocaleString("pt-BR");
  const ip = escaparHtml(dados.ip ?? "desconhecido");
  const userAgent = escaparHtml(dados.userAgent ?? "desconhecido");
  await enviar({
    destinatario,
    marca,
    descricao: "novo dispositivo",
    logDev: `Alerta de login em novo dispositivo (IP ${ip})`,
    assunto: "Novo login detectado na sua conta",
    corpoHtml: `
      <p>Detectamos um login na sua conta a partir de um dispositivo ou local que não reconhecemos.</p>
      <ul>
        <li><strong>Quando:</strong> ${quando}</li>
        <li><strong>IP:</strong> ${ip}</li>
        <li><strong>Dispositivo:</strong> ${userAgent}</li>
      </ul>
      <p>Se foi você, pode ignorar este e-mail. Se não foi, troque sua senha agora e revise as sessões ativas na sua conta.</p>
      ${rodape(marca)}
    `,
  });
}

export async function enviarEmailMfaAtivado(destinatario: string, marca: MarcaEmail = null) {
  await enviar({
    destinatario,
    marca,
    descricao: "MFA ativado",
    logDev: "Aviso de MFA ativado",
    assunto: "Verificação em duas etapas ativada",
    corpoHtml: `
      <p>A verificação em duas etapas (MFA) foi ativada na sua conta.</p>
      <p>Se não foi você, entre na sua conta agora, desative o MFA e troque sua senha.</p>
      ${rodape(marca)}
    `,
  });
}

export async function enviarEmailMfaDesativado(destinatario: string, marca: MarcaEmail = null) {
  await enviar({
    destinatario,
    marca,
    descricao: "MFA desativado",
    logDev: "Aviso de MFA desativado",
    assunto: "Verificação em duas etapas desativada",
    corpoHtml: `
      <p>A verificação em duas etapas (MFA) foi desativada na sua conta — a partir de agora, só a sua senha protege o acesso.</p>
      <p>Se não foi você, reative o MFA e troque sua senha imediatamente.</p>
      ${rodape(marca)}
    `,
  });
}

export async function enviarEmailSenhaAlterada(destinatario: string, marca: MarcaEmail = null) {
  await enviar({
    destinatario,
    marca,
    descricao: "senha alterada",
    logDev: "Aviso de senha alterada",
    assunto: "Sua senha foi alterada",
    corpoHtml: `
      <p>A senha da sua conta foi alterada. Todas as sessões ativas foram encerradas por segurança.</p>
      <p>Se não foi você, use a opção "Esqueci minha senha" para recuperar o acesso agora.</p>
      ${rodape(marca)}
    `,
  });
}

export async function enviarEmailCodigosBackupRegenerados(destinatario: string, marca: MarcaEmail = null) {
  await enviar({
    destinatario,
    marca,
    descricao: "códigos de backup regenerados",
    logDev: "Aviso de códigos de backup regenerados",
    assunto: "Códigos de backup de MFA regenerados",
    corpoHtml: `
      <p>Um novo conjunto de códigos de backup foi gerado para a verificação em duas etapas da sua conta — os códigos antigos não funcionam mais.</p>
      <p>Se não foi você, troque sua senha e revise se o MFA continua configurado do jeito que você espera.</p>
      ${rodape(marca)}
    `,
  });
}

export async function enviarEmailConfirmacaoAlteracaoEmail(
  destinatario: string,
  link: string,
  marca: MarcaEmail = null,
) {
  await enviar({
    destinatario,
    marca,
    descricao: "confirmação de alteração de e-mail",
    contaNaCota: true,
    logDev: `Link de confirmação de alteração de e-mail: ${link}`,
    assunto: "Confirme seu novo e-mail",
    corpoHtml: `
      <p>Pediram a troca do e-mail desta conta para este endereço. Clique no link
      abaixo para confirmar — o e-mail da conta só muda depois dessa confirmação:</p>
      <p><a href="${link}">${link}</a></p>
      <p ${ESTILO_NOTA}>O link expira em 1 hora. Se você não pediu essa troca, pode ignorar este e-mail.</p>
    `,
  });
}

// Aviso pro e-mail ANTIGO no momento em que a troca é PEDIDA (antes da
// confirmação) — sem isso, um pedido feito com sessão roubada só apareceria
// pro dono depois de concluído. Aqui ele tem a chance de reagir (trocar a
// senha, revisar sessões) enquanto o link de confirmação ainda não foi
// clicado.
export async function enviarEmailAlteracaoEmailSolicitada(
  destinatarioAntigo: string,
  novoEmail: string,
  marca: MarcaEmail = null,
) {
  const novoEmailEscapado = escaparHtml(novoEmail);
  await enviar({
    destinatario: destinatarioAntigo,
    marca,
    descricao: "troca de e-mail solicitada",
    logDev: `Aviso de troca de e-mail SOLICITADA (novo: ${novoEmailEscapado})`,
    assunto: "Pediram para trocar o e-mail da sua conta",
    corpoHtml: `
      <p>Alguém pediu para trocar o e-mail desta conta para <strong>${novoEmailEscapado}</strong>.
      A troca só acontece quando o link enviado para o novo endereço for confirmado.</p>
      <p>Se foi você, pode ignorar este aviso. <strong>Se não foi</strong>, troque sua senha agora
      e revise as sessões ativas — sua conta pode estar comprometida.</p>
      ${rodape(marca)}
    `,
  });
}

export async function enviarEmailEmailAlterado(
  destinatarioAntigo: string,
  novoEmail: string,
  marca: MarcaEmail = null,
) {
  const novoEmailEscapado = escaparHtml(novoEmail);
  await enviar({
    destinatario: destinatarioAntigo,
    marca,
    descricao: "e-mail alterado",
    logDev: `Aviso de e-mail alterado (novo: ${novoEmailEscapado})`,
    assunto: "O e-mail da sua conta foi alterado",
    corpoHtml: `
      <p>O e-mail desta conta foi trocado para <strong>${novoEmailEscapado}</strong>.</p>
      <p>Se não foi você, alguém pode ter acesso à sua conta — troque sua senha imediatamente e revise as sessões ativas.</p>
      ${rodape(marca)}
    `,
  });
}

export async function enviarEmailViagemImpossivel(
  destinatario: string,
  dados: { paisAnterior: string; paisAtual: string; quando: Date },
  marca: MarcaEmail = null,
) {
  const quando = dados.quando.toLocaleString("pt-BR");
  const paisAnterior = escaparHtml(dados.paisAnterior);
  const paisAtual = escaparHtml(dados.paisAtual);
  await enviar({
    destinatario,
    marca,
    descricao: "viagem impossível",
    logDev: `Alerta de viagem impossível (${paisAnterior} -> ${paisAtual})`,
    assunto: "Login suspeito: locais incompatíveis detectados",
    corpoHtml: `
      <p>Sua conta acabou de ser acessada de <strong>${paisAtual}</strong>, pouco tempo depois de
      um acesso de <strong>${paisAnterior}</strong> — distância improvável de percorrer nesse
      intervalo (${quando}).</p>
      <p>Se foi você (ex.: usando uma VPN), pode ignorar este e-mail. Se não foi, troque sua
      senha agora e revise as sessões ativas na sua conta.</p>
      ${rodape(marca)}
    `,
  });
}

export async function enviarEmailPasskeyAlterada(
  destinatario: string,
  acao: "adicionada" | "removida",
  marca: MarcaEmail = null,
) {
  await enviar({
    destinatario,
    marca,
    descricao: `passkey ${acao}`,
    logDev: `Aviso de passkey ${acao}`,
    assunto: acao === "adicionada" ? "Nova passkey adicionada" : "Passkey removida",
    corpoHtml: `
      <p>Uma passkey foi ${acao} na sua conta.</p>
      <p>Se não foi você, revise as passkeys e sessões ativas da sua conta e troque sua senha.</p>
      ${rodape(marca)}
    `,
  });
}

export async function enviarEmailContaExcluida(destinatario: string, marca: MarcaEmail = null) {
  await enviar({
    destinatario,
    marca,
    descricao: "conta excluída",
    logDev: "Confirmação de conta excluída",
    assunto: "Sua conta foi excluída",
    corpoHtml: `
      <p>Confirmamos a exclusão permanente da sua conta e de todos os dados associados a ela (sessões, MFA, dispositivos confiáveis).</p>
      <p>Se você não pediu essa exclusão, entre em contato com o suporte imediatamente — não é possível desfazer essa ação sozinho, já que a conta não existe mais para fazer login.</p>
      ${rodape(marca)}
    `,
  });
}

// Par do cadastro anti-enumeração: a tela responde igual para e-mail novo e
// e-mail já cadastrado, então é por aqui — na caixa de entrada do dono do
// endereço, que é quem já sabe que a conta existe — que a pessoa que
// esqueceu que tinha conta descobre isso e acha o caminho de volta.
export async function enviarEmailCadastroComContaExistente(
  destinatario: string,
  links: { login: string; esqueciSenha: string },
  marca: MarcaEmail = null,
) {
  await enviar({
    destinatario,
    marca,
    descricao: "cadastro com conta existente",
    contaNaCota: true,
    logDev: `Aviso de cadastro com conta existente: ${links.login} | ${links.esqueciSenha}`,
    assunto: "Tentaram criar uma conta com o seu e-mail",
    corpoHtml: `
      <p>Alguém tentou criar uma conta nova com este endereço, mas ele já tem uma conta — nada foi alterado nela.</p>
      <p>Se foi você, é só entrar: <a href="${links.login}">${links.login}</a></p>
      <p>Não lembra a senha? <a href="${links.esqueciSenha}">${links.esqueciSenha}</a></p>
      <p>Se não foi você, pode ignorar este e-mail. A senha digitada na tentativa não foi usada nem guardada.</p>
      ${rodape(marca)}
    `,
  });
}

export async function enviarEmailReusoTokenDetectado(destinatario: string, marca: MarcaEmail = null) {
  await enviar({
    destinatario,
    marca,
    descricao: "reuso de token detectado",
    logDev: "Alerta de reuso de token detectado",
    assunto: "Atividade suspeita: todas as sessões foram encerradas",
    corpoHtml: `
      <p>Detectamos o reuso de um token de sessão que já tinha sido substituído — um sinal clássico de que alguém mais pode ter tido acesso a uma sessão sua.</p>
      <p>Por segurança, <strong>todas as suas sessões ativas foram encerradas</strong> automaticamente (inclusive a sua, se estiver com alguma aba aberta agora).</p>
      <p>Se não foi você, troque sua senha assim que possível.</p>
      ${rodape(marca)}
    `,
  });
}
