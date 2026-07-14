import "server-only";

import { prisma } from "@/lib/db";

export async function registrarEvento(dados: {
  req: Request;
  evento: string;
  usuarioId?: string;
  email?: string;
}) {
  try {
    const ip =
      dados.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      dados.req.headers.get("x-real-ip") ??
      null;
    const userAgent = dados.req.headers.get("user-agent");

    await prisma.logAuditoria.create({
      data: {
        usuarioId: dados.usuarioId,
        email: dados.email,
        evento: dados.evento,
        ip,
        userAgent,
      },
    });
  } catch (erro) {
    // Log de auditoria é best-effort: uma falha aqui não deve derrubar o
    // fluxo principal (login, cadastro, logout).
    console.error("Falha ao registrar log de auditoria:", erro);
  }
}
