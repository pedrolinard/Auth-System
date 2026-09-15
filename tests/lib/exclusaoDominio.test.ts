import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { processarExclusoesDominio } from "@/lib/exclusaoDominio";
import { AUDIENCIA_SERVICO_DOMINIO, gerarTokenServicoDominio, verificarTokenAcesso } from "@/lib/token";
import { BASE_URL } from "../helpers";

// Um "Django" falso local: responde com o status que o teste mandar e guarda o
// que recebeu.
let servidor: Server;
let statusResposta = 200;
let recebidos: { authorization?: string; caminho?: string }[] = [];
const urlOriginal = process.env.DJANGO_SERVICE_URL;

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

const criadas: string[] = [];
afterEach(async () => {
  await prisma.exclusaoDominioPendente.deleteMany({ where: { organizacaoId: { in: criadas } } });
  recebidos = [];
  statusResposta = 200;
});

async function pendente(): Promise<string> {
  const organizacaoId = `org-teste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  criadas.push(organizacaoId);
  await prisma.exclusaoDominioPendente.create({ data: { organizacaoId } });
  return organizacaoId;
}

describe("Exclusão dos dados das organizações no Django (src/lib/exclusaoDominio.ts)", () => {
  it("manda um token de serviço com as organizações e tira da fila quando o Django confirma", async () => {
    const organizacaoId = await pendente();

    expect(await processarExclusoesDominio([organizacaoId])).toEqual({ excluidas: 1, falhas: 0 });
    expect(await prisma.exclusaoDominioPendente.findUnique({ where: { organizacaoId } })).toBeNull();

    expect(recebidos).toHaveLength(1);
    expect(recebidos[0].caminho).toBe("/api/dominio/interno/excluir-organizacoes");
    const token = recebidos[0].authorization!.replace("Bearer ", "");
    // Verificável pelo JWKS público, como o Django faz.
    const { payload } = await jwtVerify(token, createRemoteJWKSet(new URL(`${BASE_URL}/.well-known/jwks.json`)), {
      algorithms: ["RS256"],
      issuer: "auth-gateway",
      audience: AUDIENCIA_SERVICO_DOMINIO,
    });
    expect(payload.acao).toBe("excluir_organizacoes");
    expect(payload.organizacoes).toEqual([organizacaoId]);
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(120);
  });

  it("com o Django fora do ar, fica na fila com a tentativa e o erro registrados", async () => {
    const organizacaoId = await pendente();
    statusResposta = 503;

    expect(await processarExclusoesDominio([organizacaoId])).toEqual({ excluidas: 0, falhas: 1 });
    const linha = await prisma.exclusaoDominioPendente.findUniqueOrThrow({ where: { organizacaoId } });
    expect(linha.tentativas).toBe(1);
    expect(linha.ultimoErro).toContain("503");

    // O job tenta de novo e, com o Django de volta, resolve.
    statusResposta = 200;
    await processarExclusoesDominio([organizacaoId]);
    expect(await prisma.exclusaoDominioPendente.findUnique({ where: { organizacaoId } })).toBeNull();
  });

  it("o token de serviço não passa como access token de usuário", async () => {
    const token = await gerarTokenServicoDominio({ acao: "excluir_organizacoes", organizacoes: ["x"] });
    expect(await verificarTokenAcesso(token)).toBeNull();
  });
});
