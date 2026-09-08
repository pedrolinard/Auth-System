import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ativarChave,
  derivarKid,
  limparCacheChaves,
  montarJwks,
  obterChaveAtiva,
  registrarChave,
} from "@/lib/chavesAssinatura";
import { prisma } from "@/lib/db";
import { gerarTokenAcesso, verificarTokenAcesso } from "@/lib/token";

// O critério de saída mais importante da Fase 00: rotacionar a chave de
// assinatura sem derrubar sessão e sem deploy coordenado. Se este arquivo
// passa, a rotação é rotina; se não, ela continua sendo um evento.

const kidsCriados: string[] = [];

function gerarPar() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

function payloadDeTeste() {
  return {
    sub: "usuario-de-teste",
    email: "rotacao@teste.local",
    papel: "usuario" as const,
    aplicacaoId: "aplicacao-de-teste",
    organizacaoId: "organizacao-de-teste",
    papelOrganizacao: "dono" as const,
  };
}

let kidOriginal: string;

beforeAll(async () => {
  // Registra o par do ambiente na tabela, que é exatamente o que
  // scripts/backfill-aplicacoes.mjs faz em produção. Sem este passo o banco de
  // teste roda no fallback de bootstrap (chave só no ambiente, sem linha), e
  // aí não existe registro pra reativar no fim — foi assim que a primeira
  // versão deste arquivo passou "verde" escondendo um erro no afterAll.
  const publicaPem = Buffer.from(process.env.JWT_ACCESS_PUBLIC_KEY_B64!, "base64").toString("utf8");
  const privadaPem = Buffer.from(process.env.JWT_ACCESS_PRIVATE_KEY_B64!, "base64").toString("utf8");
  kidOriginal = await registrarChave(publicaPem, privadaPem);
  await ativarChave(kidOriginal);
});

// Devolve a chave original ao fim: os outros arquivos de teste assinam tokens
// com a chave ativa, e deixar uma chave de teste ativa contaminaria a suíte
// inteira (a ordem entre arquivos não é garantida).
afterAll(async () => {
  await ativarChave(kidOriginal);
  await prisma.chaveAssinatura.deleteMany({ where: { kid: { in: kidsCriados } } });
  limparCacheChaves();
});

describe("Rotação da chave de assinatura", () => {
  it("publica a chave nova no JWKS ANTES de ela assinar qualquer coisa", async () => {
    const { publicKey, privateKey } = gerarPar();
    const kid = await registrarChave(publicKey, privateKey);
    kidsCriados.push(kid);

    // Passo 1 da rotação: publicada, mas ainda não assinando. É essa ordem
    // que evita o erro clássico de assinar com uma chave que os consumidores
    // ainda não conhecem.
    const jwks = await montarJwks();
    expect(jwks.keys.map((chave) => chave.kid)).toContain(kid);
    expect((await obterChaveAtiva()).kid).not.toBe(kid);
  });

  it("depois de ativar, os tokens novos usam o kid novo e os antigos continuam válidos", async () => {
    const kidAntigo = (await obterChaveAtiva()).kid;
    const tokenAntesDaRotacao = await gerarTokenAcesso(payloadDeTeste());

    const { publicKey, privateKey } = gerarPar();
    const kidNovo = await registrarChave(publicKey, privateKey);
    kidsCriados.push(kidNovo);
    await ativarChave(kidNovo);

    const tokenDepoisDaRotacao = await gerarTokenAcesso(payloadDeTeste());
    const header = (token: string) =>
      JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));

    expect(header(tokenAntesDaRotacao).kid).toBe(kidAntigo);
    expect(header(tokenDepoisDaRotacao).kid).toBe(kidNovo);

    // O ponto inteiro: o token emitido ANTES da rotação continua valendo,
    // porque a chave que o assinou segue publicada. Sem isso, rotacionar
    // deslogaria todo mundo que tivesse uma sessão viva.
    expect(await verificarTokenAcesso(tokenAntesDaRotacao)).not.toBeNull();
    expect(await verificarTokenAcesso(tokenDepoisDaRotacao)).not.toBeNull();
  });

  it("a chave aposentada continua no JWKS", async () => {
    const jwks = await montarJwks();
    const publicados = jwks.keys.map((chave) => chave.kid);
    for (const kid of kidsCriados) {
      expect(publicados).toContain(kid);
    }
  });

  it("token assinado por uma chave que saiu do conjunto é recusado", async () => {
    const { publicKey, privateKey } = gerarPar();
    const kid = await registrarChave(publicKey, privateKey);
    await ativarChave(kid);
    const token = await gerarTokenAcesso(payloadDeTeste());
    expect(await verificarTokenAcesso(token)).not.toBeNull();

    // Remove a chave (passo 5 da rotação, depois da janela segura) e o token
    // que ela assinou deixa de valer — é assim que se revoga uma chave
    // comprometida.
    await prisma.chaveAssinatura.delete({ where: { kid } });
    await ativarChave(kidOriginal);
    limparCacheChaves();

    expect(await verificarTokenAcesso(token)).toBeNull();
  });

  it("o kid é derivado do conteúdo da chave pública, então é reproduzível", async () => {
    const { publicKey } = gerarPar();
    // Determinístico de propósito: é o que torna o backfill idempotente e
    // permite a qualquer um conferir o kid a partir da chave pública.
    expect(derivarKid(publicKey)).toBe(derivarKid(publicKey));
    expect(derivarKid(publicKey)).toHaveLength(16);
    expect(derivarKid(gerarPar().publicKey)).not.toBe(derivarKid(publicKey));
  });
});
