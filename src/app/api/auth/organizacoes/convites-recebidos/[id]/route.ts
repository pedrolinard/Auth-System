import { NextResponse } from "next/server";
import { efetivarAceiteConvite } from "@/lib/aceiteConvite";
import { registrarEvento } from "@/lib/auditoria";
import { autenticarRequisicao } from "@/lib/autenticar";
import { buscarConviteRecebido } from "@/lib/convitesRecebidos";
import { obterCookieCsrf } from "@/lib/cookies";
import { csrfValido } from "@/lib/csrf";
import { prisma } from "@/lib/db";

// Responder pelo painel a um convite recebido: POST aceita, DELETE recusa.
// Convite de outra pessoa, vencido, já aceito ou cancelado responde 404 igual:
// não dá pra usar esta rota pra descobrir convites alheios.

async function contexto(req: Request, id: string) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return { resposta: NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 }) };
  }
  const payload = await autenticarRequisicao(req);
  if (!payload) {
    return { resposta: NextResponse.json({ erro: "Não autenticado." }, { status: 401 }) };
  }
  const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });
  if (!usuario) {
    return { resposta: NextResponse.json({ erro: "Não autenticado." }, { status: 401 }) };
  }
  if (!usuario.emailVerificado) {
    return {
      resposta: NextResponse.json(
        { erro: "Confirme seu e-mail para responder a convites." },
        { status: 403 },
      ),
    };
  }
  const convite = await buscarConviteRecebido(usuario, id);
  if (!convite) {
    return {
      resposta: NextResponse.json(
        { erro: "Convite não encontrado, expirado ou já respondido." },
        { status: 404 },
      ),
    };
  }
  return { usuario, convite };
}

export async function POST(
  req: Request,
  { params }: RouteContext<"/api/auth/organizacoes/convites-recebidos/[id]">,
) {
  const { id } = await params;
  const resultado = await contexto(req, id);
  if (resultado.resposta) return resultado.resposta;
  return efetivarAceiteConvite(req, resultado.usuario, resultado.convite);
}

export async function DELETE(
  req: Request,
  { params }: RouteContext<"/api/auth/organizacoes/convites-recebidos/[id]">,
) {
  const { id } = await params;
  const resultado = await contexto(req, id);
  if (resultado.resposta) return resultado.resposta;
  const { usuario, convite } = resultado;

  await prisma.conviteOrganizacao.delete({ where: { id: convite.id } });
  await registrarEvento({
    req,
    evento: "convite_organizacao_recusado",
    usuarioId: usuario.id,
    email: usuario.email,
    organizacaoId: convite.organizacaoId,
  });
  return NextResponse.json({ sucesso: true });
}
