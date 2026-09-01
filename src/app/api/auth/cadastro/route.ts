import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { enviarEmailVerificacao } from "@/lib/email";
import { contarEventosPorIp, obterIp, registrarTentativaIp } from "@/lib/rateLimit";
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

export async function POST(req: Request) {
  const ip = obterIp(req);
  const tentativasIp = await contarEventosPorIp({ ip, evento: "cadastro_tentativa" });
  if (tentativasIp >= MAX_TENTATIVAS_CADASTRO) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }
  await registrarEvento({ req, evento: "cadastro_tentativa" });
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

  try {
    // Usuario + organização pessoal + associação (dono) numa transação só —
    // nunca deve existir um usuário sem organização (criarSessao depende de
    // achar pelo menos uma pra emitir o access token) nem uma organização
    // órfã se o passo do usuário falhar antes.
    const usuario = await prisma.$transaction(async (tx) => {
      const usuarioCriado = await tx.usuario.create({
        data: { nome, email, senhaHash },
        select: { id: true, nome: true, email: true, criadoEm: true },
      });
      await criarOrganizacaoPessoal(tx, usuarioCriado);
      return usuarioCriado;
    });

    await registrarEvento({ req, evento: "cadastro", usuarioId: usuario.id, email });

    const tokenVerificacao = await gerarTokenVerificacaoEmail(usuario.id);
    const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
    await enviarEmailVerificacao(email, `${baseUrl}/verificar-email?token=${tokenVerificacao}`);

    return NextResponse.json({ usuario }, { status: 201 });
  } catch (erro) {
    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === "P2002"
    ) {
      return NextResponse.json(
        { erro: "Este e-mail já está cadastrado." },
        { status: 409 },
      );
    }
    throw erro;
  }
}
