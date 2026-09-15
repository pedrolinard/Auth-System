import { NextResponse } from "next/server";
import { aceitarIpDoUsuarioFinal } from "@/lib/aplicacao";
import { concluirMfaComCodigo } from "@/lib/conclusaoMfa";
import { definirCookieDispositivoConfiavel } from "@/lib/cookies";
import { criarDispositivoConfiavel } from "@/lib/dispositivoConfiavel";
import { criarSessao } from "@/lib/sessao";

// Segunda etapa do login com o código do autenticador. Limites, suspensão e
// uso único do desafio: src/lib/conclusaoMfa.ts.
export async function POST(req: Request) {
  await aceitarIpDoUsuarioFinal(req);
  const corpo = await req.json().catch(() => null);
  const resultado = await concluirMfaComCodigo(req, corpo);
  if (resultado.tipo === "recusa") {
    return NextResponse.json(resultado.corpo, { status: resultado.status });
  }

  const sessao = await criarSessao(resultado.usuario, req);

  if (resultado.lembrarDispositivo) {
    const { token: tokenDispositivo, expiraEm } = await criarDispositivoConfiavel(resultado.usuario.id);
    await definirCookieDispositivoConfiavel(tokenDispositivo, expiraEm);
  }

  return NextResponse.json(sessao);
}
