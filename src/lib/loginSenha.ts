import "server-only";

import { after } from "next/server";

import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { contextoEmail, type AplicacaoResolvida } from "@/lib/aplicacao";
import { dispositivoEhConfiavel } from "@/lib/dispositivoConfiavel";
import { enviarEmailDispositivoNovo, enviarEmailViagemImpossivel, type MarcaEmail } from "@/lib/email";
import { formatarLocalizacao, obterGeo } from "@/lib/geo";
import {
  contarEventosPorIp,
  limiteExcedidoPorEmail,
  obterIp,
  reservarTentativas,
} from "@/lib/rateLimit";
import { verificarSenha } from "@/lib/senha";
import { bloqueioPorSuspensao } from "@/lib/sessao";
import { gerarTokenDesafioMfa, type Papel } from "@/lib/token";
import { respostaCaptchaNecessario, verificarTurnstile } from "@/lib/turnstile";
import { esquemaLogin } from "@/lib/validacao";

// Núcleo do login por e-mail e senha, compartilhado por POST /api/auth/login
// (sessão com cookies no painel ou tokens pro SDK) e pelo login hospedado do
// OpenID Connect (POST /api/oidc/entrar, que termina num código de
// autorização). Tudo que protege a conta — limites, captcha, suspensão,
// alertas de dispositivo novo e viagem impossível, desafio de MFA — mora aqui,
// pra os dois caminhos não divergirem.

// IP não é sinônimo de pessoa: várias contas atrás do mesmo NAT (rede
// doméstica, Wi-Fi de escritório, operadora de celular) compartilham o
// mesmo IP público de verdade — não é spoofing, é a topologia normal da
// internet. Um limite por IP baixo demais (era 5) derruba a casa inteira
// quando UMA pessoa erra a senha algumas vezes. Por isso o valor aqui é bem
// mais generoso que antes; quem segura a linha contra automação de verdade
// é o CAPTCHA (a partir de LIMITE_FALHAS_ANTES_DE_CAPTCHA) e o limite por
// CONTA abaixo — este aqui existe só como rede de segurança contra
// varredura maciça (muitas contas diferentes, mesmo IP).
const MAX_TENTATIVAS_LOGIN = 20;
const JANELA_LOGIN_MS = 15 * 60 * 1000;

// Depois desse tanto de falhas do mesmo IP, exige um CAPTCHA válido além das
// credenciais — antes do bloqueio duro (MAX_TENTATIVAS_LOGIN), como uma
// fricção progressiva que atrasa automação sem travar todo mundo de cara.
const LIMITE_FALHAS_ANTES_DE_CAPTCHA = 5;

// Limite por CONTA (e-mail), independente de IP: pega um ataque distribuído
// mirando uma única conta a partir de muitos IPs diferentes, cada um abaixo
// do próprio limite por IP. Convergiu com MAX_TENTATIVAS_LOGIN (20) agora
// que o limite por IP também ficou generoso — quem decide um bloqueio de
// verdade contra uma conta específica é este, não mais o de IP sozinho.
const MAX_TENTATIVAS_LOGIN_POR_CONTA = 20;
const JANELA_LOGIN_POR_CONTA_MS = 15 * 60 * 1000;

// Hash bcrypt fixo (de uma senha qualquer, nunca usada de verdade) para rodar
// contra e-mails inexistentes — sem isso, `usuario && verificarSenha(...)`
// faz curto-circuito e pula o bcrypt.compare quando o e-mail não existe,
// tornando a resposta bem mais rápida que a de um e-mail real e permitindo
// enumerar contas cadastradas pelo tempo de resposta.
const HASH_FALSO_PARA_EQUALIZAR_TEMPO =
  "$2b$12$.htri/WdfmHPQtzi/DBiXuElm0r9h1/i6mxt.MzuUkwQq9LqQ6iku";

// "Viagem impossível": os headers de geo da Vercel só dão país/região/cidade
// aproximados, sem lat/long — não dá pra calcular distância/velocidade de
// verdade. Heurística grosseira mas honesta: dois países DIFERENTES num
// intervalo curto demais pra viajar de verdade entre eles (2h cobre o caso
// comum sem gerar falso positivo o tempo todo pra quem troca de rede/VPN
// esporadicamente).
const JANELA_VIAGEM_IMPOSSIVEL_MS = 2 * 60 * 60 * 1000;

export type UsuarioAutenticado = {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  aplicacaoId: string;
};

export type ResultadoLoginSenha =
  // Recusa pronta pra devolver ao cliente (limite, captcha, credencial, suspensão).
  | { tipo: "recusa"; status: number; corpo: Record<string, unknown> }
  | { tipo: "mfa"; mfaToken: string }
  | { tipo: "autenticado"; usuario: UsuarioAutenticado };

function recusa(status: number, corpo: Record<string, unknown>): ResultadoLoginSenha {
  return { tipo: "recusa", status, corpo };
}

/**
 * Alerta de login (dispositivo novo, viagem impossível) enviado DEPOIS da
 * resposta, com a marca da aplicação dona da conta: o login não espera o
 * Resend. Dentro do after() o erro não chega mais ao onRequestError da rota,
 * e a busca da marca pode lançar — então é capturado aqui e vai pro Rollbar.
 * Usado também pelo login por passkey.
 */
export function alertarDepoisDaResposta(
  aplicacaoId: string,
  descricao: string,
  enviarAlerta: (marca: MarcaEmail) => Promise<void>,
): void {
  after(async () => {
    try {
      const { marca } = await contextoEmail(aplicacaoId);
      await enviarAlerta(marca);
    } catch (erro) {
      console.error(`Falha ao enviar o alerta de ${descricao}:`, erro);
      const { rollbarServidor } = await import("@/lib/rollbarServidor");
      rollbarServidor.error(erro as Error, { alerta: descricao });
    }
  });
}

export async function autenticarComSenha(
  req: Request,
  aplicacao: AplicacaoResolvida,
  corpo: unknown,
  // Cookie de "lembrar este dispositivo" do navegador, se houver.
  tokenDispositivoConfiavel: string | undefined,
): Promise<ResultadoLoginSenha> {
  const ip = obterIp(req);
  const falhasIp = await contarEventosPorIp({ ip, evento: "login_falha" });
  if (falhasIp >= MAX_TENTATIVAS_LOGIN) {
    return recusa(429, { erro: "Muitas tentativas. Tente novamente mais tarde." });
  }

  const dadosValidados = esquemaLogin.safeParse(corpo);
  if (!dadosValidados.success) {
    return recusa(400, { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() });
  }

  const { email, senha, turnstileToken } = dadosValidados.data;

  if (
    await limiteExcedidoPorEmail({
      aplicacaoId: aplicacao.id,
      email,
      evento: "login_falha",
      maximo: MAX_TENTATIVAS_LOGIN_POR_CONTA,
    })
  ) {
    return recusa(429, { erro: "Muitas tentativas. Tente novamente mais tarde." });
  }

  if (falhasIp >= LIMITE_FALHAS_ANTES_DE_CAPTCHA) {
    const captchaValido = await verificarTurnstile(turnstileToken, ip);
    if (!captchaValido) {
      return recusa(400, respostaCaptchaNecessario());
    }
  }

  // Os checks acima só leem os contadores; quem segura pedidos simultâneos é
  // esta reserva, feita ANTES do bcrypt (ver reservarTentativas).
  const reserva = await reservarTentativas([
    { ip, evento: "login_falha", maximo: MAX_TENTATIVAS_LOGIN, janelaMs: JANELA_LOGIN_MS },
    {
      aplicacaoId: aplicacao.id,
      email,
      evento: "login_falha",
      maximo: MAX_TENTATIVAS_LOGIN_POR_CONTA,
      janelaMs: JANELA_LOGIN_POR_CONTA_MS,
    },
  ]);
  if (!reserva) {
    return recusa(429, { erro: "Muitas tentativas. Tente novamente mais tarde." });
  }

  let usuario: Awaited<ReturnType<typeof prisma.usuario.findUnique>>;
  let senhaConfere: boolean;
  try {
    usuario = await prisma.usuario.findUnique({
      where: { aplicacaoId_email: { aplicacaoId: aplicacao.id, email } },
    });
    // Sempre roda o bcrypt.compare, mesmo sem usuário — contra o hash falso
    // acima quando não há usuário, para equalizar o tempo dos dois caminhos.
    senhaConfere = await verificarSenha(
      senha,
      usuario?.senhaHash ?? HASH_FALSO_PARA_EQUALIZAR_TEMPO,
    );
  } catch (erro) {
    // Falha nossa, não da pessoa: não conta como tentativa.
    await reserva.liberar();
    throw erro;
  }
  if (!usuario || !senhaConfere) {
    // A reserva fica: é ela que conta esta falha, por IP e por conta.
    await registrarEvento({ req, evento: "login_falha", email, aplicacaoId: aplicacao.id });
    return recusa(401, { erro: "E-mail ou senha inválidos." });
  }
  await reserva.liberar();

  const bloqueio = await bloqueioPorSuspensao(usuario.id);
  if (bloqueio) {
    await registrarEvento({ req, evento: "login_bloqueado_suspenso", usuarioId: usuario.id, email });
    return recusa(403, { erro: bloqueio });
  }

  // Detecção de "dispositivo novo" sem schema novo: reaproveita o próprio
  // LogAuditoria — se este par (ip, userAgent) nunca gerou um login_sucesso
  // antes para este usuário, é a primeira vez que o vemos. Precisa rodar
  // ANTES de registrar o evento atual, senão o registro que estamos prestes
  // a criar já "contaria" como o anterior.
  const userAgent = req.headers.get("user-agent");
  const loginAnteriorMesmoDispositivo = await prisma.logAuditoria.findFirst({
    where: { usuarioId: usuario.id, evento: "login_sucesso", ip, userAgent },
  });

  // Compara com a sessão (TokenAtualizacao) mais recente do usuário, que já
  // guarda país + o instante em que foi criada — reaproveita o dado das
  // "sessões ativas" em vez de precisar de tabela ou coluna nova. Roda ANTES
  // de criar a sessão desta requisição, senão compararia o login atual
  // consigo mesmo.
  const geoAtual = obterGeo(req);
  const ultimaSessao = await prisma.tokenAtualizacao.findFirst({
    where: { usuarioId: usuario.id },
    orderBy: { criadoEm: "desc" },
    select: { criadoEm: true, geoPais: true },
  });
  const viagemImpossivel =
    !!ultimaSessao?.geoPais &&
    !!geoAtual.pais &&
    ultimaSessao.geoPais !== geoAtual.pais &&
    Date.now() - ultimaSessao.criadoEm.getTime() < JANELA_VIAGEM_IMPOSSIVEL_MS;

  await registrarEvento({ req, evento: "login_sucesso", usuarioId: usuario.id, email });

  // O evento de auditoria continua síncrono; o e-mail sai depois da resposta
  // (ver alertarDepoisDaResposta).
  const quando = new Date();
  if (viagemImpossivel) {
    // Alerta mais específico que o de "dispositivo novo" — evita mandar os
    // dois e-mails pro mesmo login suspeito.
    await registrarEvento({ req, evento: "viagem_impossivel_detectada", usuarioId: usuario.id, email });
    alertarDepoisDaResposta(usuario.aplicacaoId, "viagem impossível", (marca) =>
      enviarEmailViagemImpossivel(usuario.email, {
        paisAnterior: formatarLocalizacao({ cidade: null, regiao: null, pais: ultimaSessao!.geoPais }) ?? ultimaSessao!.geoPais!,
        paisAtual: formatarLocalizacao({ cidade: null, regiao: null, pais: geoAtual.pais }) ?? geoAtual.pais!,
        quando,
      }, marca),
    );
  } else if (!loginAnteriorMesmoDispositivo) {
    alertarDepoisDaResposta(usuario.aplicacaoId, "dispositivo novo", (marca) =>
      enviarEmailDispositivoNovo(usuario.email, { ip, userAgent, quando }, marca),
    );
  }

  if (usuario.mfaAtivado) {
    // "Lembrar este dispositivo": pula o desafio de MFA se este navegador já
    // completou um antes e marcou a opção — a senha continua sendo exigida
    // sempre, só o segundo fator é dispensado num dispositivo já verificado.
    if (await dispositivoEhConfiavel(usuario.id, tokenDispositivoConfiavel)) {
      await registrarEvento({
        req,
        evento: "login_mfa_pulado_dispositivo_confiavel",
        usuarioId: usuario.id,
        email,
      });
      return { tipo: "autenticado", usuario };
    }

    const { token: mfaToken } = await gerarTokenDesafioMfa(usuario.id);
    return { tipo: "mfa", mfaToken };
  }

  return { tipo: "autenticado", usuario };
}
