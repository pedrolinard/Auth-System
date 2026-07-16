import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Os testes de rota (tests/api/*) batem num servidor `next dev` real, num
// processo separado — não dá pra espiar chamadas de dentro dele. Aqui,
// testamos src/lib/email.ts isolado (mesmo processo do Vitest), que é onde
// o envio de fato acontece; os testes de rota continuam garantindo que o
// fluxo principal não quebra mesmo sem RESEND_API_KEY configurada (caem no
// console.log, o mesmo código exercitado pela suíte inteira hoje).
const enviarMock = vi.fn();

// Classe real (não vi.fn().mockImplementation) porque arrow functions/mocks
// não são "construtíveis" via `new` — email.ts faz `new Resend(...)`.
vi.mock("resend", () => {
  class ResendMock {
    emails = { send: enviarMock };
  }
  return { Resend: ResendMock };
});

const RESEND_API_KEY_ORIGINAL = process.env.RESEND_API_KEY;
const EMAIL_FROM_ORIGINAL = process.env.EMAIL_FROM;

// O client Resend é criado uma vez, no module-load de src/lib/email.ts,
// a partir de `process.env.RESEND_API_KEY` — pra testar o caminho "com
// provedor configurado" é preciso resetar o registro de módulos do Vitest e
// reimportar depois de setar a env, senão o módulo já carregado (sem a
// chave) continuaria com `resend = null`.
async function carregarEmailComResendConfigurado() {
  vi.resetModules();
  process.env.RESEND_API_KEY = "re_teste_fake";
  process.env.EMAIL_FROM = "remetente@teste.local";
  return import("@/lib/email");
}

async function carregarEmailSemResendConfigurado() {
  vi.resetModules();
  delete process.env.RESEND_API_KEY;
  return import("@/lib/email");
}

describe("Notificações de segurança por e-mail (src/lib/email.ts)", () => {
  beforeEach(() => {
    enviarMock.mockReset();
    enviarMock.mockResolvedValue({ data: { id: "email-teste" }, error: null });
  });

  afterEach(() => {
    process.env.RESEND_API_KEY = RESEND_API_KEY_ORIGINAL;
    process.env.EMAIL_FROM = EMAIL_FROM_ORIGINAL;
    vi.resetModules();
  });

  it("dispositivo novo: chama o envio com IP/data e escapa o User-Agent (HTML injection)", async () => {
    const { enviarEmailDispositivoNovo } = await carregarEmailComResendConfigurado();

    await enviarEmailDispositivoNovo("usuario@teste.local", {
      ip: "10.0.0.1",
      userAgent: "<script>alert(1)</script>",
      quando: new Date("2026-01-01T12:00:00Z"),
    });

    expect(enviarMock).toHaveBeenCalledTimes(1);
    const chamada = enviarMock.mock.calls[0][0];
    expect(chamada.to).toBe("usuario@teste.local");
    expect(chamada.subject).toMatch(/novo login/i);
    expect(chamada.html).toContain("10.0.0.1");
    expect(chamada.html).not.toContain("<script>alert(1)</script>");
    expect(chamada.html).toContain("&lt;script&gt;");
  });

  it("dispositivo novo sem IP/User-Agent (ambiente sem proxy confiável) não quebra", async () => {
    const { enviarEmailDispositivoNovo } = await carregarEmailComResendConfigurado();

    await enviarEmailDispositivoNovo("usuario@teste.local", {
      ip: null,
      userAgent: null,
      quando: new Date(),
    });

    expect(enviarMock).toHaveBeenCalledTimes(1);
    expect(enviarMock.mock.calls[0][0].html).toContain("desconhecido");
  });

  it("MFA ativado/desativado, senha alterada, backup regenerado e reuso de token disparam o envio", async () => {
    const {
      enviarEmailMfaAtivado,
      enviarEmailMfaDesativado,
      enviarEmailSenhaAlterada,
      enviarEmailCodigosBackupRegenerados,
      enviarEmailReusoTokenDetectado,
    } = await carregarEmailComResendConfigurado();

    await enviarEmailMfaAtivado("usuario@teste.local");
    await enviarEmailMfaDesativado("usuario@teste.local");
    await enviarEmailSenhaAlterada("usuario@teste.local");
    await enviarEmailCodigosBackupRegenerados("usuario@teste.local");
    await enviarEmailReusoTokenDetectado("usuario@teste.local");

    expect(enviarMock).toHaveBeenCalledTimes(5);
    for (const chamada of enviarMock.mock.calls) {
      expect(chamada[0].to).toBe("usuario@teste.local");
    }
  });

  it("erro retornado pela API do provedor não lança exceção (best-effort)", async () => {
    enviarMock.mockResolvedValue({ data: null, error: { message: "falhou" } });
    const { enviarEmailMfaAtivado } = await carregarEmailComResendConfigurado();

    await expect(enviarEmailMfaAtivado("usuario@teste.local")).resolves.toBeUndefined();
  });

  it("exceção lançada pelo client (ex.: falha de rede) não derruba o fluxo (best-effort)", async () => {
    enviarMock.mockRejectedValue(new Error("timeout de rede"));
    const { enviarEmailSenhaAlterada } = await carregarEmailComResendConfigurado();

    await expect(enviarEmailSenhaAlterada("usuario@teste.local")).resolves.toBeUndefined();
  });

  it("sem RESEND_API_KEY configurada, não chama o client (cai no console.log)", async () => {
    const { enviarEmailMfaAtivado } = await carregarEmailSemResendConfigurado();

    await enviarEmailMfaAtivado("usuario@teste.local");

    expect(enviarMock).not.toHaveBeenCalled();
  });
});
