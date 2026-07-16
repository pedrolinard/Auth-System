import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { limiteExcedido, obterIp } from "@/lib/rateLimit";
import { verificarSenha } from "@/lib/senha";
import { criarSessao } from "@/lib/sessao";
import { estaSuspenso, mensagemSuspensao } from "@/lib/suspensao";
import { gerarTokenDesafioMfa } from "@/lib/token";
import { esquemaLogin } from "@/lib/validacao";

const MAX_TENTATIVAS_LOGIN = 5;
const JANELA_LOGIN_MS = 15 * 60 * 1000;

// Hash bcrypt fixo (de uma senha qualquer, nunca usada de verdade) para rodar
// contra e-mails inexistentes — sem isso, `usuario && verificarSenha(...)`
// faz curto-circuito e pula o bcrypt.compare quando o e-mail não existe,
// tornando a resposta bem mais rápida que a de um e-mail real e permitindo
// enumerar contas cadastradas pelo tempo de resposta.
const HASH_FALSO_PARA_EQUALIZAR_TEMPO =
  "$2b$12$.htri/WdfmHPQtzi/DBiXuElm0r9h1/i6mxt.MzuUkwQq9LqQ6iku";

export async function POST(req: Request) {
  const ip = obterIp(req);
  if (
    await limiteExcedido({
      ip,
      evento: "login_falha",
      maximo: MAX_TENTATIVAS_LOGIN,
      janelaMs: JANELA_LOGIN_MS,
    })
  ) {
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

  const { email, senha } = dadosValidados.data;

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

  await registrarEvento({ req, evento: "login_sucesso", usuarioId: usuario.id, email });

  if (usuario.mfaAtivado) {
    const mfaToken = await gerarTokenDesafioMfa(usuario.id);
    return NextResponse.json({ mfaObrigatorio: true, mfaToken });
  }

  const sessao = await criarSessao(usuario);
  return NextResponse.json(sessao);
}
