import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autenticarRequisicao } from "@/lib/autenticar";
import { estaSuspenso } from "@/lib/suspensao";

// Lista todos os usuários — acessível apenas para quem tem papel "admin".
export async function GET(req: Request) {
  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }
  if (payload.papel !== "admin") {
    return NextResponse.json(
      { erro: "Acesso restrito a administradores." },
      { status: 403 },
    );
  }

  const usuarios = await prisma.usuario.findMany({
    select: {
      id: true,
      nome: true,
      email: true,
      papel: true,
      criadoEm: true,
      suspenso: true,
      suspensoAte: true,
      suspensoMotivo: true,
    },
    orderBy: { criadoEm: "asc" },
  });

  // suspensoAtivo já vem calculado (suspensão temporária expirada = false)
  // pra o cliente não precisar refazer essa conta com o relógio local.
  const usuariosComStatus = usuarios.map((usuario) => ({
    ...usuario,
    suspensoAtivo: estaSuspenso(usuario),
  }));

  return NextResponse.json({ usuarios: usuariosComStatus });
}
