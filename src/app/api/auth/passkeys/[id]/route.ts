import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { enviarEmailPasskeyAlterada } from "@/lib/email";

export async function DELETE(
  req: Request,
  { params }: RouteContext<"/api/auth/passkeys/[id]">,
) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const { id } = await params;

  // where com usuarioId embutido: garante em uma query só que a passkey
  // pertence a quem está pedindo a remoção — sem isso, o id bastaria pra
  // apagar a passkey de qualquer outra conta.
  const { count } = await prisma.passkeyCredencial.deleteMany({
    where: { id, usuarioId: payload.sub },
  });
  if (count === 0) {
    return NextResponse.json({ erro: "Passkey não encontrada." }, { status: 404 });
  }

  await registrarEvento({ req, evento: "passkey_removida", usuarioId: payload.sub, email: payload.email });
  await enviarEmailPasskeyAlterada(payload.email, "removida");

  return NextResponse.json({ sucesso: true });
}
