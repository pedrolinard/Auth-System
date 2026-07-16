import { describe, expect, it } from "vitest";
import { BASE_URL } from "../helpers";

// next.config.ts define esses headers pra toda rota (headers()) — testa
// contra uma resposta real pra pegar regressão se alguém remover/alterar o
// header sem querer (ex.: durante um refactor do next.config.ts).
describe("Headers de segurança HTTP", () => {
  it("uma resposta da API inclui os headers de segurança esperados", async () => {
    const resposta = await fetch(`${BASE_URL}/api/auth/me`);

    expect(resposta.headers.get("x-frame-options")).toBe("DENY");
    expect(resposta.headers.get("x-content-type-options")).toBe("nosniff");
    expect(resposta.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(resposta.headers.get("strict-transport-security")).toContain("max-age=");
    expect(resposta.headers.get("permissions-policy")).toContain("camera=()");
    expect(resposta.headers.get("content-security-policy")).toContain("default-src 'self'");
    // Sem Report-Only: a CSP já foi validada no navegador (fontes, QR code do
    // MFA, HMR do Turbopack) e enforcing é estritamente melhor que
    // report-only quando já se sabe que a política não quebra o app.
    expect(resposta.headers.get("content-security-policy-report-only")).toBeNull();
    // X-Powered-By removido (poweredByHeader: false) — não vaza a stack.
    expect(resposta.headers.get("x-powered-by")).toBeNull();
  });
});
