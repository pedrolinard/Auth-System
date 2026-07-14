import { prisma } from "@/lib/db";

export const BASE_URL = "http://localhost:3100";
export const SENHA_TESTE = "SenhaForte123!";

export function gerarEmailTeste(prefixo: string): string {
  return `${prefixo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@teste.local`;
}

// Sem X-Forwarded-For explícito, o `next dev` local usa o IP real da conexão
// (::1) — como todos os testes rodam na mesma máquina, eles compartilhariam
// um único balde de rate limit e se atrapalhariam entre si. Cada chamada de
// teste simula um IP diferente por padrão, como clientes/dispositivos
// diferentes de verdade fariam.
export function ipAleatorio(): string {
  const parte = () => Math.floor(Math.random() * 255);
  return `10.${parte()}.${parte()}.${parte()}`;
}

export function extrairCookie(resposta: Response, nome: string): string | null {
  const cookies = resposta.headers.getSetCookie?.() ?? [];
  for (const linha of cookies) {
    const [par] = linha.split(";");
    const [chave, valor] = par.split("=");
    if (chave === nome) return decodeURIComponent(valor);
  }
  return null;
}

export function extrairTodosCookies(resposta: Response): Record<string, string> {
  const cookies = resposta.headers.getSetCookie?.() ?? [];
  const mapa: Record<string, string> = {};
  for (const linha of cookies) {
    const [par] = linha.split(";");
    const [chave, valor] = par.split("=");
    mapa[chave] = decodeURIComponent(valor);
  }
  return mapa;
}

export function cabecalhoCookie(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([nome, valor]) => `${nome}=${valor}`)
    .join("; ");
}

export async function criarUsuarioTeste(
  prefixo = "usuario",
  ip: string = ipAleatorio(),
): Promise<{ email: string; senha: string }> {
  const email = gerarEmailTeste(prefixo);
  const resposta = await fetch(`${BASE_URL}/api/auth/cadastro`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ nome: "Usuário de teste", email, senha: SENHA_TESTE }),
  });
  if (!resposta.ok) {
    throw new Error(`Falha ao criar usuário de teste (${resposta.status})`);
  }
  return { email, senha: SENHA_TESTE };
}

export async function loginTeste(
  email: string,
  senha: string,
  ip: string = ipAleatorio(),
) {
  const resposta = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ email, senha }),
  });
  if (!resposta.ok) {
    throw new Error(`Falha no login de teste (${resposta.status})`);
  }
  const cookies = extrairTodosCookies(resposta);
  return {
    resposta,
    cookies,
    // Headers prontos pra reusar em requisições autenticadas + protegidas
    // por CSRF (a maioria das mutações).
    cabecalhos: {
      Cookie: cabecalhoCookie(cookies),
      "X-CSRF-Token": cookies.csrfToken,
    } as Record<string, string>,
  };
}

export async function apagarUsuarioTeste(email: string) {
  await prisma.usuario.deleteMany({ where: { email } });
}

export async function apagarUsuariosTeste(emails: string[]) {
  await prisma.usuario.deleteMany({ where: { email: { in: emails } } });
}
