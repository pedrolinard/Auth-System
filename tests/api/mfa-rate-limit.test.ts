import { describe, expect, it } from "vitest";
import { apagarUsuariosTeste, BASE_URL, criarUsuarioTeste, loginTeste } from "../helpers";

// Mesmo princípio de tests/api/rate-limit.test.ts: cada teste usa um IP falso
// próprio pra não interferir com outros testes que também batem em /mfa/*.
function ipFalso(): string {
  const parte = () => Math.floor(Math.random() * 255);
  return `10.${parte()}.${parte()}.${parte()}`;
}

describe("Rate limiting do código MFA", () => {
  it("bloqueia /mfa/verificar com 429 após estourar tentativas de código errado", async () => {
    const usuario = await criarUsuarioTeste("mfa-rate-verificar");
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);
    const ip = ipFalso();

    const respostaIniciar = await fetch(`${BASE_URL}/api/auth/mfa/iniciar`, {
      method: "POST",
      headers: { ...cabecalhos, "X-Forwarded-For": ipFalso() },
    });
    const { segredo } = await respostaIniciar.json();

    // Não é preciso confirmar o MFA de verdade: gerar o mfaToken direto via
    // login com MFA ativado seria mais fiel, mas o rate limit em
    // /mfa/verificar independe do usuário — o que importa é o código errado
    // repetido do mesmo IP. Ativa o MFA primeiro pra ter um cenário real.
    const OTPAuth = await import("otpauth");
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(segredo),
    });
    await fetch(`${BASE_URL}/api/auth/mfa/confirmar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos, "X-Forwarded-For": ipFalso() },
      body: JSON.stringify({ codigo: totp.generate() }),
    });

    const loginComMfa = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: JSON.stringify({ email: usuario.email, senha: usuario.senha }),
    });
    const { mfaToken } = await loginComMfa.json();

    async function tentarCodigoErrado() {
      return fetch(`${BASE_URL}/api/auth/mfa/verificar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
        body: JSON.stringify({ mfaToken, codigo: "000000" }),
      });
    }

    for (let i = 0; i < 5; i++) {
      const resposta = await tentarCodigoErrado();
      expect(resposta.status).toBe(401);
    }

    const sexta = await tentarCodigoErrado();
    expect(sexta.status).toBe(429);

    await apagarUsuariosTeste([usuario.email]);
  }, 45000);
});
