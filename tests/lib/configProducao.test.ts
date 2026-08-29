import { describe, expect, it } from "vitest";
import { checarConfigProducao } from "@/lib/configProducao";

// Config mínima que não gera nenhum erro nem aviso — ponto de partida pra
// cada caso mexer só na variável que está testando.
const CONFIG_COMPLETA: Record<string, string> = {
  BASE_URL: "https://auth-gateway.example.com",
  TURNSTILE_SECRET_KEY: "secret",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site",
  RESEND_API_KEY: "re_123",
  ROLLBAR_AUTH_GATEWAY_SERVER_TOKEN_1787151157: "srv",
  NEXT_PUBLIC_ROLLBAR_AUTH_GATEWAY_CLIENT_TOKEN_1787151157: "cli",
  CRON_SECRET: "cron",
};

describe("Checagem de config de produção (src/lib/configProducao.ts)", () => {
  it("config completa não gera erro nem aviso", () => {
    const { erros, avisos } = checarConfigProducao(CONFIG_COMPLETA);
    expect(erros).toEqual([]);
    expect(avisos).toEqual([]);
  });

  it("BASE_URL ausente é erro (aborta o boot)", () => {
    const { erros } = checarConfigProducao({ ...CONFIG_COMPLETA, BASE_URL: undefined });
    expect(erros.some((e) => e.includes("BASE_URL"))).toBe(true);
  });

  it("BASE_URL vazia (string em branco) também conta como ausente", () => {
    const { erros } = checarConfigProducao({ ...CONFIG_COMPLETA, BASE_URL: "   " });
    expect(erros.some((e) => e.includes("BASE_URL"))).toBe(true);
  });

  it("Turnstile configurado pela metade é erro", () => {
    const soSecret = checarConfigProducao({
      ...CONFIG_COMPLETA,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: undefined,
    });
    expect(soSecret.erros.some((e) => e.includes("Turnstile"))).toBe(true);

    const soSiteKey = checarConfigProducao({
      ...CONFIG_COMPLETA,
      TURNSTILE_SECRET_KEY: undefined,
    });
    expect(soSiteKey.erros.some((e) => e.includes("Turnstile"))).toBe(true);
  });

  it("Turnstile totalmente ausente é só aviso (CAPTCHA desativado, mas funciona)", () => {
    const { erros, avisos } = checarConfigProducao({
      ...CONFIG_COMPLETA,
      TURNSTILE_SECRET_KEY: undefined,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: undefined,
    });
    expect(erros).toEqual([]);
    expect(avisos.some((a) => a.includes("Turnstile"))).toBe(true);
  });

  it("RESEND_API_KEY ausente é aviso, não erro", () => {
    const { erros, avisos } = checarConfigProducao({
      ...CONFIG_COMPLETA,
      RESEND_API_KEY: undefined,
    });
    expect(erros).toEqual([]);
    expect(avisos.some((a) => a.includes("RESEND_API_KEY"))).toBe(true);
  });

  it("Rollbar sem um dos tokens é aviso", () => {
    const { erros, avisos } = checarConfigProducao({
      ...CONFIG_COMPLETA,
      ROLLBAR_AUTH_GATEWAY_SERVER_TOKEN_1787151157: undefined,
    });
    expect(erros).toEqual([]);
    expect(avisos.some((a) => a.includes("Rollbar"))).toBe(true);
  });

  it("CRON_SECRET ausente é aviso", () => {
    const { erros, avisos } = checarConfigProducao({
      ...CONFIG_COMPLETA,
      CRON_SECRET: undefined,
    });
    expect(erros).toEqual([]);
    expect(avisos.some((a) => a.includes("CRON_SECRET"))).toBe(true);
  });
});
