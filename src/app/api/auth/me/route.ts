import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autenticarRequisicao } from "@/lib/autenticar";
import { contarCodigosRestantes } from "@/lib/backupMfa";
import { ehAplicacaoPadrao } from "@/lib/gestaoAplicacoes";

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

  const contaDoPainel = await ehAplicacaoPadrao(payload.aplicacaoId);
  const operadorProvedor = usuario.papel === "admin" && contaDoPainel;

  return NextResponse.json({
    usuario: {
      ...usuario,
      codigosBackupRestantes,
      // Direto do token (não é preciso consultar Membro de novo) — é o que
      // o frontend usa pra decidir se mostra as ações de admin de
      // organização (ver dashboard/page.tsx e dashboard/usuarios). Não é o
      // mesmo campo que `papel` acima (esse é o papel de SISTEMA,
      // Usuario.papel).
      organizacaoId: payload.organizacaoId,
      papelOrganizacao: payload.papelOrganizacao,
      // Decidem o que o painel mostra na gestão de aplicações. Mesmas regras
      // da autorização das rotas (autenticarGestorAplicacoes em
      // src/lib/gestaoAplicacoes.ts) — as flags só escondem links e campos;
      // quem barra de verdade é a rota.
      operadorProvedor,
      podeGerirAplicacoes:
        operadorProvedor ||
        (contaDoPainel &&
          usuario.emailVerificado &&
          (payload.papelOrganizacao === "dono" || payload.papelOrganizacao === "admin")),
    },
  });
}
