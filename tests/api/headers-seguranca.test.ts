import { describe, expect, it } from "vitest";
import { BASE_URL } from "../helpers";

function nonceDoCsp(csp: string | null): string | undefined {
  return csp?.match(/'nonce-([^']+)'/)?.[1];
}

// Os headers vêm de dois lugares: next.config.ts (headers() — os fixos, e o
// CSP das rotas de API) e src/proxy.ts (o CSP das páginas, com nonce por
// requisição). Testa contra respostas reais pra pegar regressão se alguém
// remover/alterar um deles sem querer.
describe("Headers de segurança HTTP", () => {
  it("uma resposta da API inclui os headers de segurança esperados", async () => {
    const resposta = await fetch(`${BASE_URL}/api/auth/me`);

    expect(resposta.headers.get("x-frame-options")).toBe("DENY");
    expect(resposta.headers.get("x-content-type-options")).toBe("nosniff");
    expect(resposta.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(resposta.headers.get("strict-transport-security")).toContain("max-age=");
    expect(resposta.headers.get("permissions-policy")).toContain("camera=()");
    // API não serve HTML: política fechada, sem nonce nem origem liberada.
    expect(resposta.headers.get("content-security-policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    // X-Powered-By removido (poweredByHeader: false) — não vaza a stack.
    expect(resposta.headers.get("x-powered-by")).toBeNull();
  });

  it("página tem CSP com nonce e sem 'unsafe-inline' em script-src", async () => {
    const resposta = await fetch(`${BASE_URL}/login`);
    const csp = resposta.headers.get("content-security-policy");

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    const scriptSrc = csp?.split(";").find((d) => d.trim().startsWith("script-src"));
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    // Sem Report-Only: enforcing é estritamente melhor que report-only quando
    // já se sabe que a política não quebra o app.
    expect(resposta.headers.get("content-security-policy-report-only")).toBeNull();
    expect(resposta.headers.get("x-frame-options")).toBe("DENY");
  });

  it("o nonce muda a cada requisição e é o mesmo carimbado nos scripts do HTML", async () => {
    const primeira = await fetch(`${BASE_URL}/login`);
    const segunda = await fetch(`${BASE_URL}/login`);
    const nonce1 = nonceDoCsp(primeira.headers.get("content-security-policy"));
    const nonce2 = nonceDoCsp(segunda.headers.get("content-security-policy"));

    expect(nonce1).toBeTruthy();
    expect(nonce1).not.toBe(nonce2);

    // Todo <script> do documento tem que carregar o nonce do header — um
    // sem nonce é um script que o navegador bloqueia (página quebrada).
    const html = await primeira.text();
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) {
      expect(tag).toContain(`nonce="${nonce1}"`);
    }
  });
});
