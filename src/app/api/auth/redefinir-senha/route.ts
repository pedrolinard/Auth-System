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

  const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });

  // O token de redefinição é um JWT stateless válido por 1h inteira: sem
  // essa checagem, o mesmo link poderia ser usado mais de uma vez dentro da
  // janela. Comparando o `iat` (data de emissão) do token com o instante da
  // última troca de senha, qualquer token emitido antes dela — incluindo o
  // que acabou de ser usado nesta própria requisição — deixa de valer.
  if (
    !usuario ||
    (usuario.senhaAlteradaEm && (payload.iat ?? 0) * 1000 < usuario.senhaAlteradaEm.getTime())
  ) {
    return NextResponse.json(
      { erro: "Link de redefinição inválido ou expirado." },
      { status: 401 },
    );
  }

  const senhaHash = await gerarHashSenha(novaSenha);

  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { senhaHash, senhaAlteradaEm: new Date() },
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
