import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TURNSTILE_SECRET_KEY_ORIGINAL = process.env.TURNSTILE_SECRET_KEY;

describe("Verificação server-side de CAPTCHA (src/lib/turnstile.ts)", () => {
  const fetchOriginal = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = fetchOriginal;
    process.env.TURNSTILE_SECRET_KEY = TURNSTILE_SECRET_KEY_ORIGINAL;
    vi.resetModules();
  });

  it("sem TURNSTILE_SECRET_KEY configurada, aprova sem chamar a API (não trava dev/test)", async () => {
    vi.resetModules();
    delete process.env.TURNSTILE_SECRET_KEY;
    const { verificarTurnstile } = await import("@/lib/turnstile");

    const resultado = await verificarTurnstile(undefined, "10.0.0.1");

    expect(resultado).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("configurado, mas sem token: reprova sem nem chamar a API", async () => {
    vi.resetModules();
    process.env.TURNSTILE_SECRET_KEY = "segredo-teste";
    const { verificarTurnstile } = await import("@/lib/turnstile");

    const resultado = await verificarTurnstile(undefined, "10.0.0.1");

    expect(resultado).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("configurado, com token válido (API retorna success: true): aprova", async () => {
    vi.resetModules();
    process.env.TURNSTILE_SECRET_KEY = "segredo-teste";
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    const { verificarTurnstile } = await import("@/lib/turnstile");

    const resultado = await verificarTurnstile("token-valido", "10.0.0.1");

    expect(resultado).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("configurado, com token inválido (API retorna success: false): reprova", async () => {
    vi.resetModules();
    process.env.TURNSTILE_SECRET_KEY = "segredo-teste";
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 200 }),
    );
    const { verificarTurnstile } = await import("@/lib/turnstile");

    const resultado = await verificarTurnstile("token-invalido", "10.0.0.1");

    expect(resultado).toBe(false);
  });

  it("falha de rede na verificação reprova (fail-closed — é a barreira de segurança)", async () => {
    vi.resetModules();
    process.env.TURNSTILE_SECRET_KEY = "segredo-teste";
    vi.mocked(global.fetch).mockRejectedValue(new Error("timeout de rede"));
    const { verificarTurnstile } = await import("@/lib/turnstile");

    const resultado = await verificarTurnstile("token-qualquer", "10.0.0.1");

    expect(resultado).toBe(false);
  });
});
