import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { BASE_URL } from "../helpers";

const ROTA = `${BASE_URL}/api/cron/limpar-tokens`;
const CRON_SECRET = process.env.CRON_SECRET;

// A rota só é chamada por um agendador externo com um segredo compartilhado
// (CRON_SECRET), não por sessão de usuário — os testes cobrem justamente essa
// checagem de autorização, que antes usava `!==` (não constant-time).
describe("POST /api/cron/limpar-tokens", () => {
  it("sem header Authorization, responde 401", async () => {
    const resposta = await fetch(ROTA, { method: "POST" });
    expect(resposta.status).toBe(401);
  });

  it("com um Bearer errado do mesmo tamanho, responde 401", async () => {
    const errado = "x".repeat((CRON_SECRET ?? "x".repeat(32)).length);
    const resposta = await fetch(ROTA, {
      method: "POST",
      headers: { Authorization: `Bearer ${errado}` },
    });
    expect(resposta.status).toBe(401);
  });

  it("com um Bearer de tamanho diferente, responde 401 (não 500)", async () => {
    const resposta = await fetch(ROTA, {
      method: "POST",
      headers: { Authorization: "Bearer curto" },
    });
    expect(resposta.status).toBe(401);
  });

  it("com o CRON_SECRET correto, responde 200 e devolve a contagem removida", async () => {
    expect(CRON_SECRET, "CRON_SECRET precisa estar no .env pra este teste").toBeTruthy();
    const resposta = await fetch(ROTA, {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(typeof corpo.removidos).toBe("number");
  });

  it("apaga convites aceitos e pendentes há mais de 30 dias; mantém os recentes", async () => {
    const aplicacao = await prisma.aplicacao.findFirstOrThrow({ where: { padrao: true } });
    const organizacao = await prisma.organizacao.create({
      data: { aplicacaoId: aplicacao.id, nome: "Org limpeza de convites", slug: `limpeza-convites-${Date.now()}` },
    });
    try {
      const diasAtras = (dias: number) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
      const criar = (email: string, criadoEm: Date, aceitoEm: Date | null = null) =>
        prisma.conviteOrganizacao.create({ data: { organizacaoId: organizacao.id, email, criadoEm, aceitoEm } });
      const aceito = await criar("aceito@exemplo.com", diasAtras(1), diasAtras(1));
      const vencido = await criar("vencido@exemplo.com", diasAtras(31));
      const recente = await criar("recente@exemplo.com", diasAtras(10));

      const resposta = await fetch(ROTA, { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` } });
      expect(resposta.status).toBe(200);

      const restantes = await prisma.conviteOrganizacao.findMany({ where: { organizacaoId: organizacao.id } });
      expect(restantes.map((c) => c.id)).toEqual([recente.id]);
      expect([aceito.id, vencido.id].some((id) => restantes.some((c) => c.id === id))).toBe(false);
    } finally {
      await prisma.organizacao.delete({ where: { id: organizacao.id } });
    }
  });

  // O Vercel Cron (vercel.json) chama com GET e o mesmo Bearer.
  it("GET do Vercel Cron: 401 sem o segredo, 200 com ele", async () => {
    expect((await fetch(ROTA)).status).toBe(401);
    const resposta = await fetch(ROTA, { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
    expect(resposta.status).toBe(200);
    expect(typeof (await resposta.json()).removidos).toBe("number");
  });
});
