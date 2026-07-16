import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autenticarRequisicao } from "@/lib/autenticar";
import { contarCodigosRestantes } from "@/lib/backupMfa";

export async function GET(req: Request) {
  const payload = await autenticarRequisicao(req);

  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const usuario = await prisma.usuario.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      nome: true,
      email: true,
      criadoEm: true,
      mfaAtivado: true,
      emailVerificado: true,
      papel: true,
    },
  });

  if (!usuario) {
    return NextResponse.json(
      { erro: "Usuário não encontrado." },
      { status: 404 },
    );
  }

  // Só consulta a contagem quando o MFA está ativo — sem isso, todo usuário
  // sem MFA pagaria uma query extra à toa, e o número não teria sentido
  // nenhum (não existem códigos de backup pra quem nunca ativou o MFA).
  const codigosBackupRestantes = usuario.mfaAtivado
    ? await contarCodigosRestantes(usuario.id)
    : null;

  return NextResponse.json({ usuario: { ...usuario, codigosBackupRestantes } });
}
