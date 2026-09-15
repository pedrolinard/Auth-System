import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { autenticarOperadorProvedor, gerarClientSecret } from "@/lib/gestaoAplicacoes";

// Gera um clientSecret novo e invalida o anterior no mesmo instante. Sem
// janela de convivência dos dois: o segredo existe pra ser trocado quando
// vazou, e manter o vazado valendo "por mais um tempo" é justamente o que não
// se quer. O cliente precisa atualizar a configuração dele logo em seguida —
// o painel avisa antes de confirmar.
export async function POST(
  req: Request,
  { params }: RouteContext<"/api/auth/aplicacoes/[id]/segredo">,
) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }
  const acesso = await autenticarOperadorProvedor(req);
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.erro }, { status: acesso.status });
  }

  const { id } = await params;
  const existe = await prisma.aplicacao.findUnique({ where: { id }, select: { id: true } });
  if (!existe) {
    return NextResponse.json({ erro: "Aplicação não encontrada." }, { status: 404 });
  }

  const { segredo, hash } = gerarClientSecret();
  await prisma.aplicacao.update({ where: { id }, data: { clientSecretHash: hash } });

  await registrarEvento({
    req,
    evento: "segredo_aplicacao_rotacionado",
    autorId: acesso.payload.sub,
    autorEmail: acesso.payload.email,
    aplicacaoId: acesso.payload.aplicacaoId,
  });

  return NextResponse.json({ clientSecret: segredo });
}
