import { NextResponse } from "next/server";
import { autenticarAplicacao } from "@/lib/aplicacao";
import { gerarOpcoesLoginPasskey } from "@/lib/passkey";
import { gerarTokenDesafioPasskey } from "@/lib/token";

// Público (sem autenticação) — é o próprio ponto de entrada do login sem
// senha. Sem allowCredentials (ver gerarOpcoesLoginPasskey), então nem
// precisa saber quem está tentando logar ainda. Sem rate limit de propósito:
// como challenge é barato de gerar e a tela de login pode chamar esta rota
// a cada carregamento (autofill de passkey via "conditional mediation"), um
// limite baixo quebraria esse uso legítimo — quem segura a linha contra
// abuso de verdade é o rate limit em /login/confirmar (onde a verificação
// criptográfica de fato acontece).
export async function POST(req: Request) {
  // Aqui a aplicação vem do header mesmo: ninguém está autenticado ainda, e o
  // que precisamos saber é a QUAL domínio pedir a credencial.
  // Origem cadastrada (navegador) ou client secret (servidor) — ver
  // autenticarAplicacao em src/lib/aplicacao.ts.
  const acessoAplicacao = await autenticarAplicacao(req);
  if (!acessoAplicacao.ok) {
    return NextResponse.json({ erro: acessoAplicacao.erro }, { status: acessoAplicacao.status });
  }
  const { aplicacao } = acessoAplicacao;
  const options = await gerarOpcoesLoginPasskey(aplicacao);
  const { token: passkeyToken } = await gerarTokenDesafioPasskey(options.challenge);

  return NextResponse.json({ options, passkeyToken });
}
