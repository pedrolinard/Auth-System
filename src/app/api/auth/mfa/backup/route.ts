import { NextResponse } from "next/server";
import { aceitarIpDoUsuarioFinal } from "@/lib/aplicacao";
import { concluirMfaComBackup } from "@/lib/conclusaoMfa";
import { criarSessao } from "@/lib/sessao";

// Login com um código de backup, pra quem perdeu o autenticador. Limites,
// suspensão e uso único do desafio: src/lib/conclusaoMfa.ts.
export async function POST(req: Request) {
  await aceitarIpDoUsuarioFinal(req);
  const corpo = await req.json().catch(() => null);
  const resultado = await concluirMfaComBackup(req, corpo);
  if (resultado.tipo === "recusa") {
    return NextResponse.json(resultado.corpo, { status: resultado.status });
  }

  const sessao = await criarSessao(resultado.usuario, req);
  return NextResponse.json({ ...sessao, codigosBackupRestantes: resultado.codigosBackupRestantes });
}
