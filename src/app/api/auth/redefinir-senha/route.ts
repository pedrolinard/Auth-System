import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { gerarHashSenha } from "@/lib/senha";
import { verificarTokenRedefinicaoSenha } from "@/lib/token";
import { esquemaRedefinirSenha } from "@/lib/validacao";

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaRedefinirSenha.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const { token, novaSenha } = dadosValidados.data;
  const payload = await verificarTokenRedefinicaoSenha(token);
  if (!payload) {
    return NextResponse.json(
      { erro: "Link de redefinição inválido ou expirado." },
      { status: 401 },
    );
  }

  const senhaHash = await gerarHashSenha(novaSenha);

  await prisma.usuario.update({
    where: { id: payload.sub },
    data: { senhaHash },
  });

  // A senha antiga pode ter sido comprometida — derruba todas as sessões
  // ativas, igual ao "sair de todos os dispositivos".
  await prisma.tokenAtualizacao.updateMany({
    where: { usuarioId: payload.sub, revogadoEm: null },
    data: { revogadoEm: new Date() },
  });

  await registrarEvento({ req, evento: "senha_redefinida", usuarioId: payload.sub });

  return NextResponse.json({ sucesso: true });
}
