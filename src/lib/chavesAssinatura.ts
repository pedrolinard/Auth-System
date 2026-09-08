import "server-only";

import { createHash } from "node:crypto";
import { exportJWK, importPKCS8, importSPKI, type JWK } from "jose";

import { criptografar, descriptografar } from "@/lib/cripto";
import { prisma } from "@/lib/db";

// Conjunto de chaves RS256 que assinam o access token.
//
// Antes existia uma chave só, vinda de variável de ambiente, e o JWT saía sem
// `kid` no header. Isso tornava a rotação um evento coordenado: trocar a chave
// significava trocar a env var dos DOIS serviços ao mesmo tempo e torcer pra
// nenhum token da janela anterior ainda estar vivo. Com um conjunto nomeado e
// publicado em JWKS, rotacionar vira rotina: publica a nova, espera o cache
// dos consumidores virar, e só então passa a assinar com ela.

// O kid é derivado do CONTEÚDO da chave pública, não sorteado: quem tem a
// chave pública consegue recalcular e conferir, e importar a mesma chave duas
// vezes não cria duas linhas. Mesma função usada pelo backfill — se mudar
// aqui, tem que mudar lá.
export function derivarKid(publicaPem: string): string {
  return createHash("sha256").update(publicaPem).digest("hex").slice(0, 16);
}

type ChaveAtiva = { kid: string; privada: CryptoKey };

// Cache de processo, curto: a chave ativa muda só numa rotação, e um atraso de
// até um minuto entre rotacionar e passar a assinar com a nova é justamente o
// comportamento desejado (a chave nova precisa estar publicada no JWKS antes
// de assinar qualquer coisa).
const TTL_MS = 60_000;

let ativaCache: { valor: ChaveAtiva | null; expiraEm: number } | null = null;
const publicasCache = new Map<string, CryptoKey>();
let jwksCache: { valor: { keys: JWK[] }; expiraEm: number } | null = null;

/** Só para os testes: zera os caches depois de mexer nas chaves. */
export function limparCacheChaves() {
  ativaCache = null;
  publicasCache.clear();
  jwksCache = null;
}

// Fallback de bootstrap: banco sem nenhuma chave cadastrada (dev recém-clonado,
// banco de teste zerado) continua funcionando com o par que está no ambiente.
// É o mesmo par que o backfill importa pra tabela, então o kid coincide — um
// token assinado antes do backfill continua verificável depois dele.
function parDoAmbiente(): { kid: string; publicaPem: string; privadaPem: string } | null {
  const publicaB64 = process.env.JWT_ACCESS_PUBLIC_KEY_B64;
  const privadaB64 = process.env.JWT_ACCESS_PRIVATE_KEY_B64;
  if (!publicaB64 || !privadaB64) return null;

  const publicaPem = Buffer.from(publicaB64, "base64").toString("utf8");
  const privadaPem = Buffer.from(privadaB64, "base64").toString("utf8");
  return { kid: derivarKid(publicaPem), publicaPem, privadaPem };
}

/** A chave que assina os tokens novos. */
export async function obterChaveAtiva(): Promise<ChaveAtiva> {
  if (ativaCache && ativaCache.expiraEm > Date.now() && ativaCache.valor) {
    return ativaCache.valor;
  }

  const linha = await prisma.chaveAssinatura.findFirst({
    where: { ativa: true },
    select: { kid: true, privadaCifrada: true },
  });

  let valor: ChaveAtiva;
  if (linha) {
    valor = {
      kid: linha.kid,
      privada: await importPKCS8(descriptografar(linha.privadaCifrada), "RS256"),
    };
  } else {
    const ambiente = parDoAmbiente();
    if (!ambiente) {
      throw new Error(
        "Nenhuma chave de assinatura ativa: rode npm run backfill:aplicacoes ou defina JWT_ACCESS_PRIVATE_KEY_B64/JWT_ACCESS_PUBLIC_KEY_B64.",
      );
    }
    valor = {
      kid: ambiente.kid,
      privada: await importPKCS8(ambiente.privadaPem, "RS256"),
    };
  }

  ativaCache = { valor, expiraEm: Date.now() + TTL_MS };
  return valor;
}

/**
 * A chave pública de um `kid`. `null` quando o kid é desconhecido — token
 * assinado por chave que já saiu do conjunto, ou forjado.
 *
 * `kid` ausente cai na chave ATIVA: é a janela de compatibilidade com os
 * tokens emitidos antes desta mudança, que não têm o header. Eles morrem
 * sozinhos em 15 minutos (vida do access token), e aí este caminho vira letra
 * morta — mas sem ele, subir o código novo invalidaria toda sessão viva de
 * uma vez, que é exatamente o tipo de quebra que esta Fase existe pra evitar.
 */
export async function obterChavePublica(kid: string | undefined): Promise<CryptoKey | null> {
  if (!kid) {
    const ativa = await obterChaveAtiva().catch(() => null);
    if (!ativa) return null;
    return obterChavePublica(ativa.kid);
  }

  const emCache = publicasCache.get(kid);
  if (emCache) return emCache;

  const linha = await prisma.chaveAssinatura.findUnique({
    where: { kid },
    select: { publicaPem: true },
  });

  const pem = linha?.publicaPem ?? (parDoAmbiente()?.kid === kid ? parDoAmbiente()!.publicaPem : null);
  if (!pem) return null;

  const chave = await importSPKI(pem, "RS256");
  publicasCache.set(kid, chave);
  return chave;
}

/**
 * O conteúdo de /.well-known/jwks.json: todas as chaves publicadas, ativa e
 * aposentadas. Uma chave aposentada continua aqui enquanto puder existir token
 * vivo assinado por ela — tirá-la antes disso derruba sessões em andamento.
 */
export async function montarJwks(): Promise<{ keys: JWK[] }> {
  if (jwksCache && jwksCache.expiraEm > Date.now()) return jwksCache.valor;

  const linhas = await prisma.chaveAssinatura.findMany({
    select: { kid: true, publicaPem: true },
    orderBy: { criadoEm: "desc" },
  });

  const fonte = [...linhas];
  if (fonte.length === 0) {
    const ambiente = parDoAmbiente();
    if (ambiente) fonte.push({ kid: ambiente.kid, publicaPem: ambiente.publicaPem });
  }

  const keys: JWK[] = [];
  for (const { kid, publicaPem } of fonte) {
    const jwk = await exportJWK(await importSPKI(publicaPem, "RS256"));
    keys.push({ ...jwk, kid, alg: "RS256", use: "sig" });
  }

  const valor = { keys };
  jwksCache = { valor, expiraEm: Date.now() + TTL_MS };
  return valor;
}

/**
 * Registra um par novo no conjunto, sem ativá-lo. É o primeiro passo da
 * rotação: publicar antes de assinar, para que todo consumidor já conheça a
 * chave quando o primeiro token assinado por ela aparecer.
 */
export async function registrarChave(publicaPem: string, privadaPem: string) {
  const kid = derivarKid(publicaPem);
  await prisma.chaveAssinatura.upsert({
    where: { kid },
    update: {},
    create: { kid, publicaPem, privadaCifrada: criptografar(privadaPem), ativa: false },
  });
  limparCacheChaves();
  return kid;
}

/**
 * Passa a assinar com `kid`. Aposenta a anterior sem removê-la do JWKS — ela
 * ainda precisa validar os tokens que assinou até eles expirarem.
 */
export async function ativarChave(kid: string) {
  await prisma.$transaction([
    prisma.chaveAssinatura.updateMany({
      where: { ativa: true },
      data: { ativa: false, aposentadaEm: new Date() },
    }),
    prisma.chaveAssinatura.update({
      where: { kid },
      data: { ativa: true, aposentadaEm: null },
    }),
  ]);
  limparCacheChaves();
}
