import "server-only";

import { NextResponse } from "next/server";
import { registrarEvento } from "@/lib/auditoria";
import {
  limiteExcedido,
  limiteExcedidoPorEmail,
  obterIp,
  registrarTentativaEmail,
  registrarTentativaIp,
} from "@/lib/rateLimit";
import { verificarSenha } from "@/lib/senha";

const MAX_TENTATIVAS_SENHA_ATUAL = 5;
const JANELA_SENHA_ATUAL_MS = 5 * 60 * 1000;

// Confirmação da senha atual antes de uma ação irreversível — mesma fricção
// e mesmo orçamento de tentativas ("senha_atual_falha", por IP e por e-mail)
// da exclusão de conta e do export LGPD: um access token roubado sozinho não
// basta, e não dá pra forçar a senha sem limite. Devolve a resposta de erro
// pronta, ou null quando a senha confere.
export async function conferirSenhaAtual(
  req: Request,
  usuario: { id: string; email: string; aplicacaoId: string; senhaHash: string },
  senha: string,
): Promise<NextResponse | null> {
  const ip = obterIp(req);
  const excedido =
    (await limiteExcedido({ ip, evento: "senha_atual_falha", maximo: MAX_TENTATIVAS_SENHA_ATUAL })) ||
    (await limiteExcedidoPorEmail({
      aplicacaoId: usuario.aplicacaoId,
      email: usuario.email,
      evento: "senha_atual_falha",
      maximo: MAX_TENTATIVAS_SENHA_ATUAL,
    }));
  if (excedido) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }

  if (await verificarSenha(senha, usuario.senhaHash)) return null;

  await registrarEvento({
    req,
    evento: "senha_atual_falha",
    usuarioId: usuario.id,
    email: usuario.email,
  });
  await registrarTentativaIp({ ip, evento: "senha_atual_falha", janelaMs: JANELA_SENHA_ATUAL_MS });
  await registrarTentativaEmail({
    aplicacaoId: usuario.aplicacaoId,
    email: usuario.email,
    evento: "senha_atual_falha",
    janelaMs: JANELA_SENHA_ATUAL_MS,
  });
  return NextResponse.json({ erro: "Senha incorreta." }, { status: 401 });
}
