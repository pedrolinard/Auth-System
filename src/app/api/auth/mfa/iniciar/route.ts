import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autenticarRequisicao } from "@/lib/autenticar";
import { gerarQrCodeMfa, gerarSegredoMfa } from "@/lib/mfa";

export async function POST(req: Request) {
  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const usuario = await prisma.usuario.findUnique({
    where: { id: payload.sub },
  });
  if (!usuario) {
    return NextResponse.json(
      { erro: "Usuário não encontrado." },
      { status: 404 },
    );
  }

  if (usuario.mfaAtivado) {
    return NextResponse.json(
      { erro: "A verificação em duas etapas já está ativada." },
      { status: 409 },
    );
  }

  // Gera um segredo novo a cada chamada; fica pendente até ser confirmado
  // com um código válido em /api/auth/mfa/confirmar.
  const segredo = gerarSegredoMfa();
  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { mfaSecret: segredo },
  });

  const { otpauthUrl, qrCodeDataUrl } = await gerarQrCodeMfa(
    segredo,
    usuario.email,
  );

  return NextResponse.json({ segredo, otpauthUrl, qrCodeDataUrl });
}
