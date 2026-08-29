import { describe, expect, it } from "vitest";
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
});
