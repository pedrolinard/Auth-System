import { Client } from "pg";

// `pg` puro (em vez de @/lib/db ou do client gerado do Prisma) porque este
// arquivo roda no runtime do Playwright, fora do bundler do Next.js: o guard
// `server-only` de src/lib/db.ts derruba imports fora desse contexto, e o
// client ESM gerado pelo Prisma usa `import.meta`, que o transform do
// Playwright não suporta. `pg` é CJS simples, sem nenhum dos dois problemas.
async function comConexao<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export const SENHA_TESTE = "SenhaForte123!";

export function gerarEmailTeste(prefixo: string): string {
  return `e2e-${prefixo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@teste.local`;
}

// Sem isso, todo teste que passa por /api/auth/cadastro compartilha o IP
// real de loopback do Chromium — rodar a suíte umas duas vezes na mesma hora
// já estoura MAX_TENTATIVAS_CADASTRO (5/hora por IP, src/app/api/auth/cadastro/route.ts)
// e trava todo cadastro subsequente com 429. Mesmo truque de
// tests/helpers.ts: um X-Forwarded-For falso por teste simula IPs
// diferentes (next dev confia no header sem checar proxy — trade-off já
// documentado no README).
export function ipAleatorio(): string {
  const parte = () => Math.floor(Math.random() * 255);
  return `10.${parte()}.${parte()}.${parte()}`;
}

export async function apagarUsuarioTeste(email: string) {
  await comConexao((client) => client.query(`DELETE FROM usuarios WHERE email = $1`, [email]));
}
