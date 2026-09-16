import { describe, expect, it } from "vitest";
import { BASE_URL } from "../helpers";

const ROTA = `${BASE_URL}/api/cron/webhooks`;
const CRON_SECRET = process.env.CRON_SECRET;

// Mesma autorização do job diário (src/lib/autorizacaoCron.ts): quem anda a
// fila de webhooks fora do job é um agendador externo com o segredo.
describe("/api/cron/webhooks", () => {
  it("sem o segredo ou com um errado, responde 401 (GET e POST)", async () => {
    expect((await fetch(ROTA)).status).toBe(401);
    expect((await fetch(ROTA, { method: "POST" })).status).toBe(401);
    const errado = "x".repeat((CRON_SECRET ?? "x".repeat(32)).length);
    const resposta = await fetch(ROTA, { method: "POST", headers: { Authorization: `Bearer ${errado}` } });
    expect(resposta.status).toBe(401);
  });

  it("com o CRON_SECRET, responde 200 com a contagem da fila", async () => {
    expect(CRON_SECRET, "CRON_SECRET precisa estar no .env pra este teste").toBeTruthy();
    const resposta = await fetch(ROTA, { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` } });
    expect(resposta.status).toBe(200);
    const { webhooks } = await resposta.json();
    expect(typeof webhooks.entregues).toBe("number");
    expect(typeof webhooks.falhas).toBe("number");
  });
});
