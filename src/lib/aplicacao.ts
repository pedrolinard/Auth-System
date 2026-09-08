import "server-only";

import { prisma } from "@/lib/db";

// Header que o SDK manda com o clientId da aplicação. Ele SELECIONA o tenant
// e nada mais: entra no `where` de toda leitura e no `data` de toda escrita,
// mas nunca autoriza — autorização continua vindo do access token. Tratar
// este valor como credencial seria confundir identificação com autenticação:
// ele é público por definição (vive no JavaScript do cliente).
export const HEADER_APLICACAO = "x-aplicacao-id";

export type AplicacaoResolvida = {
  id: string;
  clientId: string;
  nome: string;
  origens: string[];
  passkeyRpId: string | null;
};

// Cache em memória do processo. A resolução acontece em TODA requisição de
// auth (login, cadastro, refresh, passkey...) e a linha muda raramente — sem
// cache, seria uma ida ao banco a mais no caminho crítico de cada uma delas,
// que é exatamente o custo que o contador dedicado de rate limit acabou de
// eliminar.
//
// O TTL é o atraso máximo entre desativar um cliente e ele parar de
// autenticar — 30s por padrão. Configurável porque os testes precisam
// verificar a desativação de imediato: com cache, o teste teria que dormir
// meio minuto ou confiar num comportamento que não consegue observar.
// APLICACAO_CACHE_TTL_MS=0 desliga (é o que tests/globalSetup.ts faz).
const TTL_CACHE_MS = Number(process.env.APLICACAO_CACHE_TTL_MS ?? 30_000);
const cache = new Map<string, { valor: AplicacaoResolvida | null; expiraEm: number }>();

const CHAVE_PADRAO = "\0padrao";

function doCache(chave: string): { valor: AplicacaoResolvida | null } | null {
  if (TTL_CACHE_MS <= 0) return null;
  const entrada = cache.get(chave);
  if (!entrada) return null;
  if (entrada.expiraEm < Date.now()) {
    cache.delete(chave);
    return null;
  }
  return entrada;
}

function guardar(chave: string, valor: AplicacaoResolvida | null) {
  if (TTL_CACHE_MS <= 0) return;
  cache.set(chave, { valor, expiraEm: Date.now() + TTL_CACHE_MS });
}

/** Só para os testes: zera o cache entre casos que criam/desativam aplicações. */
export function limparCacheAplicacoes() {
  cache.clear();
}

function selecionar() {
  return {
    id: true,
    clientId: true,
    nome: true,
    origens: true,
    passkeyRpId: true,
  } as const;
}

// A aplicação de primeira parte — o próprio painel deste projeto. É onde cai
// toda requisição que chega sem o header: o dashboard, as páginas de login e
// cadastro, o serviço Django. É o que permite a Fase 00 entrar sem reescrever
// nenhuma tela, e é garantidamente única (índice parcial em `padrao`).
async function obterPadrao(): Promise<AplicacaoResolvida | null> {
  const emCache = doCache(CHAVE_PADRAO);
  if (emCache) return emCache.valor;

  const aplicacao = await prisma.aplicacao.findFirst({
    where: { padrao: true, ativa: true },
    select: selecionar(),
  });
  guardar(CHAVE_PADRAO, aplicacao);
  return aplicacao;
}

async function obterPorClientId(clientId: string): Promise<AplicacaoResolvida | null> {
  const emCache = doCache(clientId);
  if (emCache) return emCache.valor;

  const aplicacao = await prisma.aplicacao.findFirst({
    where: { clientId, ativa: true },
    select: selecionar(),
  });
  // Guarda inclusive o `null`: sem isso, uma enxurrada de requisições com
  // clientId inexistente vira uma enxurrada de consultas ao banco.
  guardar(clientId, aplicacao);
  return aplicacao;
}

/**
 * Resolve a aplicação de uma requisição. Sem o header, cai na aplicação
 * padrão. Devolve `null` quando o clientId informado não existe ou está
 * desativado — o chamador responde 400, nunca 401: não é um problema de
 * autenticação do usuário, é a aplicação que não pode falar com o provedor.
 */
export async function resolverAplicacao(req: Request): Promise<AplicacaoResolvida | null> {
  const clientId = req.headers.get(HEADER_APLICACAO)?.trim();
  if (!clientId) return obterPadrao();
  return obterPorClientId(clientId);
}

/**
 * A aplicação de uma conta já conhecida (usuario.aplicacaoId). Usada pelas
 * rotas autenticadas, onde a aplicação não pode vir do header: numa sessão já
 * estabelecida, quem manda é a conta, não quem está falando.
 */
export async function obterAplicacaoPorId(id: string): Promise<AplicacaoResolvida | null> {
  const emCache = doCache(id);
  if (emCache) return emCache.valor;

  const aplicacao = await prisma.aplicacao.findUnique({
    where: { id },
    select: selecionar(),
  });
  guardar(id, aplicacao);
  return aplicacao;
}

/**
 * Confere se a requisição veio de uma origem que a aplicação declarou.
 *
 * Uma aplicação sem nenhuma origem cadastrada aceita qualquer uma — é o caso
 * de integração servidor-a-servidor, onde não existe navegador e o header
 * `origin` simplesmente não vem. A checagem só morde quando a lista existe E o
 * navegador mandou origem, que é precisamente o cenário que ela protege.
 */
export function origemPermitida(aplicacao: AplicacaoResolvida, req: Request): boolean {
  if (aplicacao.origens.length === 0) return true;
  const origem = req.headers.get("origin");
  if (!origem) return true;
  return aplicacao.origens.includes(origem);
}
