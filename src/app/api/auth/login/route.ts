import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { enviarEmailDispositivoNovo } from "@/lib/email";
import {
  contarEventosPorIp,
  limiteExcedidoPorEmail,
  obterIp,
} from "@/lib/rateLimit";
import { verificarSenha } from "@/lib/senha";
import { criarSessao } from "@/lib/sessao";
import { estaSuspenso, mensagemSuspensao } from "@/lib/suspensao";
import { gerarTokenDesafioMfa } from "@/lib/token";
import { verificarTurnstile } from "@/lib/turnstile";
import { esquemaLogin } from "@/lib/validacao";

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

export async function POST(req: Request) {
  const ip = obterIp(req);
  const falhasIp = await contarEventosPorIp({
    ip,
    evento: "login_falha",
    janelaMs: JANELA_LOGIN_MS,
  });
  if (falhasIp >= MAX_TENTATIVAS_LOGIN) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }

  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaLogin.safeParse(corpo);

  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const { email, senha, turnstileToken } = dadosValidados.data;

  if (
    await limiteExcedidoPorEmail({
      email,
      evento: "login_falha",
      maximo: MAX_TENTATIVAS_LOGIN_POR_CONTA,
      janelaMs: JANELA_LOGIN_POR_CONTA_MS,
    })
  ) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }

  if (falhasIp >= LIMITE_FALHAS_ANTES_DE_CAPTCHA) {
    const captchaValido = await verificarTurnstile(turnstileToken, ip);
    if (!captchaValido) {
      return NextResponse.json(
        { erro: "Verificação anti-automação necessária.", captchaNecessario: true },
        { status: 400 },
      );
    }
  }

  const usuario = await prisma.usuario.findUnique({ where: { email } });
  // Sempre roda o bcrypt.compare, mesmo sem usuário — contra o hash falso
  // acima quando não há usuário, para equalizar o tempo dos dois caminhos.
  const senhaConfere = await verificarSenha(
    senha,
    usuario?.senhaHash ?? HASH_FALSO_PARA_EQUALIZAR_TEMPO,
  );
  const credenciaisValidas = usuario && senhaConfere;

  if (!credenciaisValidas) {
    await registrarEvento({ req, evento: "login_falha", email });
    return NextResponse.json(
      { erro: "E-mail ou senha inválidos." },
      { status: 401 },
    );
  }

  if (estaSuspenso(usuario)) {
    await registrarEvento({ req, evento: "login_bloqueado_suspenso", usuarioId: usuario.id, email });
    return NextResponse.json({ erro: mensagemSuspensao(usuario) }, { status: 403 });
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

  await registrarEvento({ req, evento: "login_sucesso", usuarioId: usuario.id, email });

  if (!loginAnteriorMesmoDispositivo) {
    await enviarEmailDispositivoNovo(usuario.email, { ip, userAgent, quando: new Date() });
  }

  if (usuario.mfaAtivado) {
    const { token: mfaToken } = await gerarTokenDesafioMfa(usuario.id);
    return NextResponse.json({ mfaObrigatorio: true, mfaToken });
  }

  const sessao = await criarSessao(usuario);
  return NextResponse.json(sessao);
}
