import { NextRequest, NextResponse } from "next/server";
import { origemDeAlgumaAplicacao } from "@/lib/aplicacao";
import { NOME_COOKIE_ATUALIZACAO } from "@/lib/cookies";
import { cspDePagina, gerarNonce } from "@/lib/csp";
import { verificarTokenAtualizacao } from "@/lib/token";

const ROTAS_PROTEGIDAS = ["/dashboard"];
const ROTAS_SOMENTE_VISITANTE = ["/login", "/cadastro"];

// Headers que uma aplicação cliente pode mandar do navegador. O
// x-aplicacao-segredo fica de fora de propósito: o client secret nunca deve
// sair de um navegador, e não liberá-lo aqui faz o próprio navegador recusar
// a tentativa antes de ela chegar ao provedor.
const CABECALHOS_CORS_PERMITIDOS = "content-type, authorization, x-aplicacao-id";

function cabecalhosCors(origem: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origem,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": CABECALHOS_CORS_PERMITIDOS,
    "Access-Control-Max-Age": "600",
    // Sem Allow-Credentials: cookies do provedor não atravessam domínios. A
    // aplicação cliente usa os tokens do corpo e o header Authorization.
    Vary: "Origin",
  };
}

// CORS das rotas de auth pra aplicações clientes em outros domínios. Só
// responde com os headers pra origens cadastradas em alguma aplicação ativa;
// se a origem é da aplicação CERTA, quem decide é a própria rota
// (autenticarAplicacao). Sem os headers, o navegador bloqueia a leitura da
// resposta — é o que impede um site qualquer de usar o provedor.
async function tratarCors(req: NextRequest): Promise<NextResponse> {
  const origem = req.headers.get("origin");
  if (!origem || origem === req.nextUrl.origin) return NextResponse.next();

  const permitida = await origemDeAlgumaAplicacao(origem);
  if (req.method === "OPTIONS") {
    return permitida
      ? new NextResponse(null, { status: 204, headers: cabecalhosCors(origem) })
      : new NextResponse(null, { status: 403 });
  }
  const resposta = NextResponse.next();
  if (permitida) {
    for (const [nome, valor] of Object.entries(cabecalhosCors(origem))) {
      resposta.headers.set(nome, valor);
    }
  }
  return resposta;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/")) return tratarCors(req);

  const rotaProtegida = ROTAS_PROTEGIDAS.some((rota) =>
    pathname.startsWith(rota),
  );
  const rotaSomenteVisitante = ROTAS_SOMENTE_VISITANTE.includes(pathname);

  if (rotaProtegida || rotaSomenteVisitante) {
    const cookie = req.cookies.get(NOME_COOKIE_ATUALIZACAO)?.value;
    // Checagem otimista: apenas valida a assinatura do token, sem consultar o
    // banco. A validação definitiva (revogação, etc.) acontece nas rotas de API.
    const sessaoValida = cookie ? Boolean(await verificarTokenAtualizacao(cookie)) : false;

    if (rotaProtegida && !sessaoValida) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    if (rotaSomenteVisitante && sessaoValida) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }

  // CSP com nonce novo a cada requisição (ver src/lib/csp.ts). O Next lê o
  // nonce do header Content-Security-Policy DA REQUISIÇÃO durante o render e
  // o aplica sozinho nos próprios scripts; o da RESPOSTA é o que o navegador
  // aplica. Os dois têm que ser o mesmo valor.
  const csp = cspDePagina(gerarNonce(), process.env.NODE_ENV === "development");
  const cabecalhosRequisicao = new Headers(req.headers);
  cabecalhosRequisicao.set("Content-Security-Policy", csp);

  const resposta = NextResponse.next({ request: { headers: cabecalhosRequisicao } });
  resposta.headers.set("Content-Security-Policy", csp);
  return resposta;
}

export const config = {
  matcher: [
    // Rotas de auth: só CORS (o CSP delas é o fixo de next.config.ts).
    "/api/auth/:path*",
    // Toda página. Fora: o resto das rotas de API e os assets do
    // build/estáticos, que não são documento e não precisam de nonce.
    "/((?!api/|_next/static|_next/image|favicon.ico).*)",
  ],
};
