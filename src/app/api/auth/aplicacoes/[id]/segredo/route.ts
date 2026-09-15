import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import {
  alvoAplicacao,
  autenticarGestorAplicacoes,
  escopoDoGestor,
  gerarClientSecret,
} from "@/lib/gestaoAplicacoes";

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
  const acesso = await autenticarGestorAplicacoes(req);
  if (!acesso.ok) {
    return NextResponse.json({ erro: acesso.erro }, { status: acesso.status });
  }
  const { gestor } = acesso;

  const { id } = await params;
  const existe = await prisma.aplicacao.findFirst({
    where: { id, ...escopoDoGestor(gestor) },
    select: { id: true, clientId: true, nome: true },
  });
  if (!existe) {
    return NextResponse.json({ erro: "Aplicação não encontrada." }, { status: 404 });
  }

  const { segredo, hash } = gerarClientSecret();
  await prisma.aplicacao.update({ where: { id }, data: { clientSecretHash: hash } });

  await registrarEvento({
    req,
    evento: "segredo_aplicacao_rotacionado",
    autorId: gestor.payload.sub,
    autorEmail: gestor.payload.email,
    aplicacaoId: gestor.payload.aplicacaoId,
    organizacaoId: gestor.organizacaoDonaId ?? undefined,
    alvo: alvoAplicacao(existe),
  });

  return NextResponse.json({ clientSecret: segredo });
}
