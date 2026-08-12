import "server-only";

import { prisma } from "@/lib/db";
import { obterIp } from "@/lib/rateLimit";

export async function registrarEvento(dados: {
  req: Request;
  evento: string;
  usuarioId?: string;
  email?: string;
}) {
  try {
    console.error(
      "[diagnostico-timezone-temporario]",
      JSON.stringify({
        TZ: process.env.TZ ?? null,
        resolvedTz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        offsetMin: new Date().getTimezoneOffset(),
        now: new Date().toISOString(),
      }),
    );
    const ip = obterIp(dados.req);
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
