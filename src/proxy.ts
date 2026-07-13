import { NextRequest, NextResponse } from "next/server";
import { NOME_COOKIE_ATUALIZACAO } from "@/lib/cookies";
import { verificarTokenAtualizacao } from "@/lib/token";

const ROTAS_PROTEGIDAS = ["/dashboard"];
const ROTAS_SOMENTE_VISITANTE = ["/login", "/cadastro"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const cookie = req.cookies.get(NOME_COOKIE_ATUALIZACAO)?.value;
  // Checagem otimista: apenas valida a assinatura do token, sem consultar o
  // banco. A validação definitiva (revogação, etc.) acontece nas rotas de API.
  const sessaoValida = cookie ? Boolean(await verificarTokenAtualizacao(cookie)) : false;

  const rotaProtegida = ROTAS_PROTEGIDAS.some((rota) =>
    pathname.startsWith(rota),
  );
  const rotaSomenteVisitante = ROTAS_SOMENTE_VISITANTE.includes(pathname);

  if (rotaProtegida && !sessaoValida) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (rotaSomenteVisitante && sessaoValida) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/cadastro"],
};
