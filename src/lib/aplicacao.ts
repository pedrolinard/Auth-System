import "server-only";

import { createHash } from "node:crypto";

import { compararEmTempoConstante } from "@/lib/cripto";
import { prisma } from "@/lib/db";
import type { MarcaEmail } from "@/lib/email";

// Header que o SDK manda com o clientId da aplicação. Ele SELECIONA o tenant
// e nada mais: entra no `where` de toda leitura e no `data` de toda escrita,
// mas nunca autoriza — autorização continua vindo do access token. Tratar
// este valor como credencial seria confundir identificação com autenticação:
// ele é público por definição (vive no JavaScript do cliente).
export const HEADER_APLICACAO = "x-aplicacao-id";

// Header com o client secret — o que AUTENTICA a aplicação numa chamada de
// servidor (ver autenticarAplicacao). Nunca vai no navegador.
export const HEADER_SEGREDO_APLICACAO = "x-aplicacao-segredo";

export type AplicacaoResolvida = {
  id: string;
  clientId: string;
  nome: string;
  origens: string[];
  passkeyRpId: string | null;
  padrao: boolean;
  clientSecretHash: string | null;
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
    padrao: true,
    clientSecretHash: true,
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
 * Marca e endereço base dos links dos e-mails de uma conta — os dois vêm da
 * APLICAÇÃO DONA DA CONTA, nunca do header da requisição (um e-mail de
 * redefinição de senha pedido "em nome" de outra aplicação não pode sair com
 * a marca nem com os links dela). Aplicação padrão: sem marca e com os links
 * nas páginas do próprio provedor, como sempre foi.
 */
export async function contextoEmail(
  aplicacaoId: string,
): Promise<{ marca: MarcaEmail; baseLinks: string }> {
  const baseProvedor = process.env.BASE_URL ?? "http://localhost:3000";
  const aplicacao = await prisma.aplicacao.findUnique({
    where: { id: aplicacaoId },
    select: { nome: true, padrao: true, emailRemetente: true, urlLinks: true, logoUrl: true },
  });
  if (!aplicacao || aplicacao.padrao) return { marca: null, baseLinks: baseProvedor };
  return {
    marca: { nome: aplicacao.nome, remetente: aplicacao.emailRemetente, logoUrl: aplicacao.logoUrl },
    baseLinks: aplicacao.urlLinks ?? baseProvedor,
  };
}

/**
 * Se a aplicação dona de uma conta continua ativa. Sem cache de propósito:
 * é usada nos passos que concluem um login iniciado ANTES (MFA, código de
 * backup) — o desafio vive até 5 min, e desativar a aplicação nesse meio-tempo
 * precisa barrar a conclusão na hora, não 30s depois.
 */
export async function aplicacaoEstaAtiva(aplicacaoId: string): Promise<boolean> {
  const aplicacao = await prisma.aplicacao.findUnique({
    where: { id: aplicacaoId },
    select: { ativa: true },
  });
  return aplicacao?.ativa === true;
}

export type ResultadoAutenticacaoAplicacao =
  | { ok: true; aplicacao: AplicacaoResolvida }
  | { ok: false; status: 400 | 401 | 403; erro: string };

/**
 * Resolve a aplicação da requisição E confere que quem fala por ela tem
 * direito — é o ponto de entrada das rotas públicas de auth (cadastro, login,
 * esqueci-senha, login por passkey).
 *
 * O clientId sozinho não prova nada: é público. Então, pra uma aplicação
 * cliente:
 *
 * - chamada de NAVEGADOR (tem header Origin): a origem precisa estar
 *   cadastrada. Lista vazia recusa — antes, uma aplicação sem origens aceitava
 *   qualquer site, e qualquer página na internet podia montar um formulário
 *   de login falando em nome dela.
 * - chamada de SERVIDOR (sem Origin): exige o client secret. Sem origem não
 *   há navegador pra conferir, e era exatamente o caso que a allowlist de
 *   origens deixava passar sem checagem nenhuma.
 *
 * A aplicação padrão (o próprio painel) segue a regra anterior: é quem serve
 * as páginas deste projeto e o serviço Django, na mesma origem.
 */
export async function autenticarAplicacao(req: Request): Promise<ResultadoAutenticacaoAplicacao> {
  const aplicacao = await resolverAplicacao(req);
  if (!aplicacao) {
    return { ok: false, status: 400, erro: "Aplicação inválida ou desativada." };
  }

  if (aplicacao.padrao) {
    return origemPermitida(aplicacao, req)
      ? { ok: true, aplicacao }
      : { ok: false, status: 403, erro: "Origem não autorizada para esta aplicação." };
  }

  const origem = req.headers.get("origin");
  if (origem) {
    return aplicacao.origens.includes(origem)
      ? { ok: true, aplicacao }
      : { ok: false, status: 403, erro: "Origem não autorizada para esta aplicação." };
  }

  const segredo = req.headers.get(HEADER_SEGREDO_APLICACAO);
  const segredoConfere =
    !!segredo &&
    !!aplicacao.clientSecretHash &&
    compararEmTempoConstante(
      createHash("sha256").update(segredo).digest("hex"),
      aplicacao.clientSecretHash,
    );
  return segredoConfere
    ? { ok: true, aplicacao }
    : { ok: false, status: 401, erro: "Credencial da aplicação ausente ou inválida." };
}

/**
 * Se alguma aplicação ativa declarou esta origem — é a pergunta do preflight
 * CORS, que chega sem o header x-aplicacao-id (o navegador só informa QUAIS
 * headers vai mandar, não os valores). A checagem de que a origem é da
 * aplicação CERTA acontece depois, na própria rota, por autenticarAplicacao.
 */
export async function origemDeAlgumaAplicacao(origem: string): Promise<boolean> {
  const chave = `\0origem:${origem}`;
  const emCache = doCache(chave);
  if (emCache) return emCache.valor !== null;

  const aplicacao = await prisma.aplicacao.findFirst({
    where: { ativa: true, origens: { has: origem } },
    select: selecionar(),
  });
  guardar(chave, aplicacao);
  return aplicacao !== null;
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
