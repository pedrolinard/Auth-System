import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { alvosDaExclusao, processarExclusoesDominio } from "@/lib/exclusaoDominio";
import { AUDIENCIA_SERVICO_DOMINIO, gerarTokenServicoDominio, verificarTokenAcesso } from "@/lib/token";
import { BASE_URL } from "../helpers";

// Um "Django" falso local: responde com o status que o teste mandar e guarda o
// que recebeu.
let servidor: Server;
let statusResposta = 200;
let recebidos: { authorization?: string; caminho?: string }[] = [];
const urlOriginal = process.env.DJANGO_SERVICE_URL;
const jwks = createRemoteJWKSet(new URL(`${BASE_URL}/.well-known/jwks.json`));

beforeAll(async () => {
  servidor = createServer((req: IncomingMessage, res) => {
    recebidos.push({ authorization: req.headers.authorization, caminho: req.url });
    req.resume();
    req.on("end", () => {
      res.writeHead(statusResposta, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  process.env.DJANGO_SERVICE_URL = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(async () => {
  process.env.DJANGO_SERVICE_URL = urlOriginal;
  await new Promise((resolve) => servidor.close(resolve));
});

const criados: string[] = [];
afterEach(async () => {
  await prisma.exclusaoDominioPendente.deleteMany({ where: { alvo: { in: criados } } });
  criados.length = 0;
  recebidos = [];
  statusResposta = 200;
});

function idUnico(prefixo: string) {
  return `${prefixo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function enfileirar(dados: { organizacoes: string[]; usuarioId: string }): Promise<string[]> {
  const alvos = alvosDaExclusao(dados);
  criados.push(...alvos);
  await prisma.exclusaoDominioPendente.createMany({ data: alvos.map((alvo) => ({ alvo })) });
  return alvos;
}

async function payloadRecebido(indice: number): Promise<JWTPayload> {
  const token = recebidos[indice].authorization!.replace("Bearer ", "");
  // Verificável pelo JWKS público, como o Django faz.
  const { payload } = await jwtVerify(token, jwks, {
    algorithms: ["RS256"],
    issuer: "auth-gateway",
    audience: AUDIENCIA_SERVICO_DOMINIO,
  });
  return payload;
}

describe("Exclusão dos dados no Django (src/lib/exclusaoDominio.ts)", () => {
  it("manda um token de serviço com organizações e conta, e tira da fila quando o Django confirma", async () => {
    const organizacao = idUnico("org");
    const usuario = idUnico("usr");
    const alvos = await enfileirar({ organizacoes: [organizacao], usuarioId: usuario });

    expect(await processarExclusoesDominio(alvos)).toEqual({ excluidas: 2, falhas: 0 });
    expect(await prisma.exclusaoDominioPendente.count({ where: { alvo: { in: alvos } } })).toBe(0);

    expect(recebidos).toHaveLength(1);
    expect(recebidos[0].caminho).toBe("/api/dominio/interno/excluir-dados");
    const payload = await payloadRecebido(0);
    expect(payload.acao).toBe("excluir_dados");
    expect(payload.organizacoes).toEqual([organizacao]);
    expect(payload.usuarios).toEqual([usuario]);
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(120);
  });

  it("com o Django fora do ar, fica na fila com a tentativa e o erro registrados", async () => {
    const alvos = await enfileirar({ organizacoes: [idUnico("org")], usuarioId: idUnico("usr") });
    statusResposta = 503;

    expect(await processarExclusoesDominio(alvos)).toEqual({ excluidas: 0, falhas: 2 });
    const linha = await prisma.exclusaoDominioPendente.findUniqueOrThrow({ where: { alvo: alvos[0] } });
    expect(linha.tentativas).toBe(1);
    expect(linha.ultimoErro).toContain("503");

    // O job tenta de novo e, com o Django de volta, resolve.
    statusResposta = 200;
    await processarExclusoesDominio(alvos);
    expect(await prisma.exclusaoDominioPendente.count({ where: { alvo: { in: alvos } } })).toBe(0);
  });

  it("mais de um lote sai na mesma rodada, sem esperar o job", async () => {
    const organizacoes = Array.from({ length: 150 }, () => idUnico("org"));
    const alvos = await enfileirar({ organizacoes, usuarioId: idUnico("usr") });

    expect(await processarExclusoesDominio(alvos)).toEqual({ excluidas: 151, falhas: 0 });
    expect(recebidos).toHaveLength(2);
    const [primeiro, segundo] = [await payloadRecebido(0), await payloadRecebido(1)];
    const total = [primeiro, segundo].reduce(
      (soma, p) => soma + (p.organizacoes as string[]).length + (p.usuarios as string[]).length,
      0,
    );
    expect(total).toBe(151);
  });

  it("o token de serviço não passa como access token de usuário", async () => {
    const token = await gerarTokenServicoDominio({ acao: "excluir_dados", organizacoes: ["x"], usuarios: [] });
    expect(await verificarTokenAcesso(token)).toBeNull();
  });
});
