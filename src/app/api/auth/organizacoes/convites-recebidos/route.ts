import { NextResponse } from "next/server";
import { autenticarRequisicao } from "@/lib/autenticar";
import { listarConvitesRecebidos } from "@/lib/convitesRecebidos";
import { prisma } from "@/lib/db";

// Convites pendentes para o e-mail da conta logada (ver convitesRecebidos.ts).
export async function GET(req: Request) {
  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }
  const usuario = await prisma.usuario.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, aplicacaoId: true, emailVerificado: true },
  });
  if (!usuario) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }
  if (!usuario.emailVerificado) {
    return NextResponse.json({ convites: [], emailVerificado: false });
  }

  const convites = await listarConvitesRecebidos(usuario);
  return NextResponse.json({
    emailVerificado: true,
    convites: convites.map((c) => ({
      id: c.id,
      papel: c.papel,
      criadoEm: c.criadoEm,
      organizacaoNome: c.organizacao.nome,
      convidadoPorNome: c.criadoPor?.nome ?? null,
    })),
  });
}
