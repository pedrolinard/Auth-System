import "server-only";

import { NextResponse } from "next/server";
import { registrarEvento } from "@/lib/auditoria";
import { limiteExcedido, limiteExcedidoPorEmail, obterIp, reservarTentativas } from "@/lib/rateLimit";
import { verificarSenha } from "@/lib/senha";

const MAX_TENTATIVAS_SENHA_ATUAL = 5;
const JANELA_SENHA_ATUAL_MS = 5 * 60 * 1000;

const MUITAS_TENTATIVAS = { erro: "Muitas tentativas. Tente novamente mais tarde." };

// Confirmação da senha atual antes de uma ação irreversível — mesma fricção
// e mesmo orçamento de tentativas ("senha_atual_falha", por IP e por e-mail)
// em todo lugar que a pede (troca de e-mail, export LGPD, exclusão de conta,
// exclusão e transferência de organização): um access token roubado sozinho
// não basta, e não dá pra forçar a senha sem limite. Devolve a resposta de
// erro pronta, ou null quando a senha confere.
export async function conferirSenhaAtual(
  req: Request,
  usuario: { id: string; email: string; aplicacaoId: string; senhaHash: string },
  senha: string,
  // Texto do 401: cada tela tem o seu, e o E2E depende dele.
  mensagemSenhaErrada = "Senha incorreta.",
): Promise<NextResponse | null> {
  const ip = obterIp(req);
  const conta = { aplicacaoId: usuario.aplicacaoId, email: usuario.email, evento: "senha_atual_falha" };
  const excedido =
    (await limiteExcedido({ ip, evento: "senha_atual_falha", maximo: MAX_TENTATIVAS_SENHA_ATUAL })) ||
    (await limiteExcedidoPorEmail({ ...conta, maximo: MAX_TENTATIVAS_SENHA_ATUAL }));
  if (excedido) return NextResponse.json(MUITAS_TENTATIVAS, { status: 429 });

  // Os checks acima só leem; quem segura pedidos simultâneos é a reserva
  // (ver reservarTentativas em lib/rateLimit.ts).
  const reserva = await reservarTentativas([
    { ip, evento: "senha_atual_falha", maximo: MAX_TENTATIVAS_SENHA_ATUAL, janelaMs: JANELA_SENHA_ATUAL_MS },
    { ...conta, maximo: MAX_TENTATIVAS_SENHA_ATUAL, janelaMs: JANELA_SENHA_ATUAL_MS },
  ]);
  if (!reserva) return NextResponse.json(MUITAS_TENTATIVAS, { status: 429 });

  let confere: boolean;
  try {
    confere = await verificarSenha(senha, usuario.senhaHash);
  } catch (erro) {
    await reserva.liberar();
    throw erro;
  }
  if (confere) {
    await reserva.liberar();
    return null;
  }

  // A reserva fica: é ela que conta esta falha.
  await registrarEvento({
    req,
    evento: "senha_atual_falha",
    usuarioId: usuario.id,
    email: usuario.email,
  });
  return NextResponse.json({ erro: mensagemSenhaErrada }, { status: 401 });
}
