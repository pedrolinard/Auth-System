import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autenticarRequisicao } from "@/lib/autenticar";

// publicKey/credentialId/contador nunca saem daqui — a tela só precisa do
// suficiente pra listar e deixar remover (apelido, quando foi criada/usada).
export async function GET(req: Request) {
  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const passkeys = await prisma.passkeyCredencial.findMany({
    where: { usuarioId: payload.sub },
    orderBy: { criadoEm: "desc" },
    select: { id: true, nome: true, criadoEm: true, ultimoUsoEm: true },
  });

  return NextResponse.json({ passkeys });
}
