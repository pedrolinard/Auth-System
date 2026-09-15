import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

export type AplicacaoTeste = { id: string; clientId: string; clientSecret: string };

// Aplicação cliente com client secret, criada direto no banco. Chamada de
// servidor (sem Origin) de uma aplicação cliente exige o segredo — ver
// autenticarAplicacao em src/lib/aplicacao.ts.
export async function criarAplicacaoTeste(
  nome: string,
  // `aprovada` padrão true: é o que o operador cria. false simula uma
  // aplicação self-service ainda não aprovada.
  opcoes: { origens?: string[]; aprovada?: boolean } = {},
): Promise<AplicacaoTeste> {
  const clientSecret = `sec_teste_${randomBytes(16).toString("hex")}`;
  const aplicacao = await prisma.aplicacao.create({
    data: {
      nome,
      clientId: `app_teste_${randomBytes(6).toString("hex")}`,
      clientSecretHash: createHash("sha256").update(clientSecret).digest("hex"),
      origens: opcoes.origens ?? [],
      aprovada: opcoes.aprovada ?? true,
    },
    select: { id: true, clientId: true },
  });
  return { ...aplicacao, clientSecret };
}

// Headers de uma chamada de SERVIDOR em nome da aplicação.
export function cabecalhosAplicacao(
  aplicacao: { clientId: string; clientSecret: string },
  ip: string = ipAleatorio(),
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Forwarded-For": ip,
    "x-aplicacao-id": aplicacao.clientId,
    "x-aplicacao-segredo": aplicacao.clientSecret,
  };
}

// Apaga as aplicações e tudo que ficou preso a elas (o Restrict de Usuario e
// Organizacao impede apagar a aplicação antes).
export async function apagarAplicacoesTeste(ids: string[]) {
  await prisma.usuario.deleteMany({ where: { aplicacaoId: { in: ids } } });
  await prisma.organizacao.deleteMany({ where: { aplicacaoId: { in: ids } } });
  await prisma.aplicacao.deleteMany({ where: { id: { in: ids } } });
}

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
    // por CSRF (a maioria das mutações). Levam o mesmo IP simulado do login:
    // sem ele, toda chamada autenticada da suíte caía no IP local e dividia os
    // contadores de rate limit por IP (criar organização é 10/h) — algumas
    // rodadas seguidas bastavam pra testes começarem a receber 429.
    cabecalhos: {
      Cookie: cabecalhoCookie(cookies),
      "X-CSRF-Token": cookies.csrfToken,
      "X-Forwarded-For": ip,
    } as Record<string, string>,
  };
}

export async function apagarUsuarioTeste(email: string) {
  await apagarUsuariosTeste([email]);
}

// Apaga as contas E as organizações que ficariam sem nenhum membro depois
// disso. Membro cai em cascata com a conta, mas Organizacao não — sem esta
// segunda etapa, cada rodada da suíte deixava dezenas de organizações órfãs
// no banco de teste.
export async function apagarUsuariosTeste(emails: string[]) {
  const organizacoes = await prisma.membro.findMany({
    where: { usuario: { email: { in: emails } } },
    select: { organizacaoId: true },
  });
  await prisma.usuario.deleteMany({ where: { email: { in: emails } } });
  await prisma.organizacao.deleteMany({
    where: {
      id: { in: organizacoes.map((o) => o.organizacaoId) },
      membros: { none: {} },
    },
  });
}
