import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarAplicacao, contextoEmail } from "@/lib/aplicacao";
import { enviarEmailCadastroComContaExistente, enviarEmailVerificacao } from "@/lib/email";
import {
  contarEventosPorIp,
  limiteExcedidoPorEmail,
  obterIp,
  registrarTentativaEmail,
  registrarTentativaIp,
} from "@/lib/rateLimit";
import { criarOrganizacaoPessoal } from "@/lib/organizacao";
import { gerarHashSenha } from "@/lib/senha";
import { senhaFoiVazada } from "@/lib/senhaVazada";
import { gerarTokenVerificacaoEmail } from "@/lib/token";
import { verificarTurnstile } from "@/lib/turnstile";
import { esquemaCadastro } from "@/lib/validacao";

const MAX_TENTATIVAS_CADASTRO = 5;
const JANELA_CADASTRO_MS = 60 * 60 * 1000;

// Mesmo raciocínio do login: exige CAPTCHA antes do bloqueio duro, como
// fricção progressiva contra automação (ex.: criação em massa de contas).
const LIMITE_TENTATIVAS_ANTES_DE_CAPTCHA = 3;

// Mesmo teto do esqueci-senha (3/h por e-mail), pelo mesmo motivo: é um
// e-mail disparado para um endereço que quem faz a requisição escolhe.
const MAX_AVISOS_CONTA_EXISTENTE = 3;
const JANELA_AVISOS_CONTA_EXISTENTE_MS = 60 * 60 * 1000;

// Resposta ÚNICA do cadastro, seja o e-mail novo ou já cadastrado — ver o
// tratamento do P2002 abaixo. Não devolve o usuário criado (id, criadoEm):
// esses campos só existiriam no caso "conta nova", e a diferença de formato
// já entregaria a resposta que o status esconde.
const RESPOSTA_CADASTRO = {
  mensagem: "Cadastro recebido. Enviamos um e-mail para o endereço informado.",
};

export async function POST(req: Request) {
  // Origem cadastrada (navegador) ou client secret (servidor) — ver
  // autenticarAplicacao em src/lib/aplicacao.ts.
  const acessoAplicacao = await autenticarAplicacao(req);
  if (!acessoAplicacao.ok) {
    return NextResponse.json({ erro: acessoAplicacao.erro }, { status: acessoAplicacao.status });
  }
  const { aplicacao } = acessoAplicacao;

  const ip = obterIp(req);
  const tentativasIp = await contarEventosPorIp({ ip, evento: "cadastro_tentativa" });
  if (tentativasIp >= MAX_TENTATIVAS_CADASTRO) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }
  await registrarEvento({ req, evento: "cadastro_tentativa", aplicacaoId: aplicacao.id });
  await registrarTentativaIp({ ip, evento: "cadastro_tentativa", janelaMs: JANELA_CADASTRO_MS });

  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaCadastro.safeParse(corpo);

  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const { nome, email, senha, turnstileToken } = dadosValidados.data;

  if (tentativasIp >= LIMITE_TENTATIVAS_ANTES_DE_CAPTCHA) {
    const captchaValido = await verificarTurnstile(turnstileToken, ip);
    if (!captchaValido) {
      return NextResponse.json(
        { erro: "Verificação anti-automação necessária.", captchaNecessario: true },
        { status: 400 },
      );
    }
  }

  if (await senhaFoiVazada(senha)) {
    return NextResponse.json(
      {
        erro: "Essa senha apareceu em vazamentos de dados conhecidos. Escolha outra.",
      },
      { status: 400 },
    );
  }

  const senhaHash = await gerarHashSenha(senha);
  // Marca e endereço dos links vêm da aplicação dona da conta (ver
  // contextoEmail) — a mesma nos dois caminhos abaixo, conta nova ou existente.
  const { marca, baseLinks } = await contextoEmail(aplicacao.id);

  try {
    // Usuario + organização pessoal + associação (dono) numa transação só —
    // nunca deve existir um usuário sem organização (criarSessao depende de
    // achar pelo menos uma pra emitir o access token) nem uma organização
    // órfã se o passo do usuário falhar antes.
    const usuario = await prisma.$transaction(async (tx) => {
      const usuarioCriado = await tx.usuario.create({
        data: { nome, email, senhaHash, aplicacaoId: aplicacao.id },
        select: { id: true, nome: true, email: true, criadoEm: true, aplicacaoId: true },
      });
      await criarOrganizacaoPessoal(tx, usuarioCriado);
      return usuarioCriado;
    });

    await registrarEvento({ req, evento: "cadastro", usuarioId: usuario.id, email });

    const tokenVerificacao = await gerarTokenVerificacaoEmail(usuario.id);
    await enviarEmailVerificacao(email, `${baseLinks}/verificar-email?token=${tokenVerificacao}`, marca);

    return NextResponse.json(RESPOSTA_CADASTRO, { status: 201 });
  } catch (erro) {
    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === "P2002"
    ) {
      // E-mail já cadastrado NESTA aplicação (o índice é (aplicacaoId,
      // email)). Responde exatamente como um cadastro novo: um 409 aqui
      // confirmava a qualquer um que o endereço tem conta. Mesmo formato,
      // mesmo status, e o mesmo trabalho antes de responder (hash da senha
      // já feito acima, tentativa de insert, um envio de e-mail) pra o tempo
      // de resposta também não separar os dois casos. Quem avisa o dono é o
      // e-mail, que só ele lê.
      await registrarEvento({
        req,
        evento: "cadastro_conta_existente",
        email,
        aplicacaoId: aplicacao.id,
      });
      // Teto por endereço: sem ele, dá pra usar o cadastro pra encher a
      // caixa de alguém de avisos só repetindo o e-mail dele de IPs
      // diferentes (o limite por IP acima não pega isso). Passado o teto, a
      // resposta continua a mesma — só o e-mail deixa de sair.
      if (
        !(await limiteExcedidoPorEmail({
          aplicacaoId: aplicacao.id,
          email,
          evento: "cadastro_conta_existente",
          maximo: MAX_AVISOS_CONTA_EXISTENTE,
        }))
      ) {
        await registrarTentativaEmail({
          aplicacaoId: aplicacao.id,
          email,
          evento: "cadastro_conta_existente",
          janelaMs: JANELA_AVISOS_CONTA_EXISTENTE_MS,
        });
        await enviarEmailCadastroComContaExistente(
          email,
          { login: `${baseLinks}/login`, esqueciSenha: `${baseLinks}/esqueci-senha` },
          marca,
        );
      }
      return NextResponse.json(RESPOSTA_CADASTRO, { status: 201 });
    }
    throw erro;
  }
}
