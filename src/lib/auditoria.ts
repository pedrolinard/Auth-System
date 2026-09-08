import "server-only";

import { prisma } from "@/lib/db";
import { obterIp } from "@/lib/rateLimit";

export async function registrarEvento(dados: {
  req: Request;
  evento: string;
  usuarioId?: string;
  email?: string;
  // Só faz sentido quando o ator difere do alvo (ex.: admin agindo sobre
  // outra conta) — usuarioId/email acima continuam descrevendo o ALVO.
  autorId?: string;
  autorEmail?: string;
  // Escopo do evento. Opcional porque a maioria dos ~30 pontos de chamada tem
  // um usuarioId e daria pra derivar dele (é o que o fallback abaixo faz);
  // passar explicitamente importa nos eventos SEM usuário — login_falha de
  // e-mail inexistente, cadastro_tentativa —, que de outro modo cairiam fora
  // de qualquer escopo e sumiriam do painel do cliente.
  aplicacaoId?: string;
  organizacaoId?: string;
}) {
  try {
    const ip = obterIp(dados.req);
    const userAgent = dados.req.headers.get("user-agent");

    // Uma consulta a mais por evento, por chave primária, dentro de um caminho
    // que já está escrevendo no banco e já é best-effort — barato o bastante
    // pra valer a garantia de que nenhum evento de um usuário conhecido fica
    // sem aplicação.
    let aplicacaoId = dados.aplicacaoId;
    if (!aplicacaoId && dados.usuarioId) {
      const usuario = await prisma.usuario.findUnique({
        where: { id: dados.usuarioId },
        select: { aplicacaoId: true },
      });
      aplicacaoId = usuario?.aplicacaoId;
    }

    await prisma.logAuditoria.create({
      data: {
        usuarioId: dados.usuarioId,
        email: dados.email,
        evento: dados.evento,
        ip,
        userAgent,
        autorId: dados.autorId,
        autorEmail: dados.autorEmail,
        aplicacaoId,
        organizacaoId: dados.organizacaoId,
      },
    });
  } catch (erro) {
    // Log de auditoria é best-effort: uma falha aqui não deve derrubar o
    // fluxo principal (login, cadastro, logout).
    console.error("Falha ao registrar log de auditoria:", erro);
  }
}
