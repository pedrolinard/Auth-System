import { describe, expect, it } from "vitest";
import { apagarUsuariosTeste, BASE_URL, criarUsuarioTeste } from "../helpers";

// O rate limit é por IP (extraído de X-Forwarded-For); cada teste usa um IP
// falso próprio pra não interferir um no outro.
function ipFalso(): string {
  const parte = () => Math.floor(Math.random() * 255);
  return `10.${parte()}.${parte()}.${parte()}`;
}

describe("Rate limiting", () => {
  it("bloqueia login com 429 após estourar o limite de tentativas erradas do mesmo IP", async () => {
    const usuario = await criarUsuarioTeste("rate-limit-login");
    const ip = ipFalso();

    async function tentarLoginErrado() {
      return fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
        body: JSON.stringify({ email: usuario.email, senha: "SenhaErrada999" }),
      });
    }

    for (let i = 0; i < 20; i++) {
      const resposta = await tentarLoginErrado();
      expect(resposta.status).toBe(401);
    }

    const vigesimaPrimeira = await tentarLoginErrado();
    expect(vigesimaPrimeira.status).toBe(429);

    await apagarUsuariosTeste([usuario.email]);
  }, 60000); // 21 chamadas sequenciais com bcrypt + 1ª compilação da rota no Turbopack

  it("bloqueia login com 429 por CONTA quando as falhas vêm de IPs diferentes (cross-IP)", async () => {
    // O limite por IP sozinho não pegaria isso: cada IP abaixo faz só UMA
    // tentativa (bem abaixo do próprio limite de 5), mas a mesma CONTA
    // acumula falhas de todos eles — exatamente o padrão de um ataque
    // distribuído (credential stuffing) mirando um único alvo.
    const usuario = await criarUsuarioTeste("rate-limit-conta");

    async function tentarLoginErradoDeOutroIp() {
      return fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": ipFalso() },
        body: JSON.stringify({ email: usuario.email, senha: "SenhaErrada999" }),
      });
    }

    for (let i = 0; i < 20; i++) {
      const resposta = await tentarLoginErradoDeOutroIp();
      expect(resposta.status).toBe(401);
    }

    const vigesimaPrimeira = await tentarLoginErradoDeOutroIp();
    expect(vigesimaPrimeira.status).toBe(429);

    await apagarUsuariosTeste([usuario.email]);
  }, 120000);

  it("bloqueia cadastro com 429 após estourar o limite de tentativas do mesmo IP", async () => {
    const ip = ipFalso();
    const emailsCriados: string[] = [];

    async function tentarCadastrar() {
      const email = `rate-limit-cadastro-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@teste.local`;
      emailsCriados.push(email);
      return fetch(`${BASE_URL}/api/auth/cadastro`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
        body: JSON.stringify({ nome: "Teste", email, senha: "SenhaForte123!" }),
      });
    }

    for (let i = 0; i < 5; i++) {
      const resposta = await tentarCadastrar();
      expect(resposta.status).toBe(201);
    }

    const sexta = await tentarCadastrar();
    expect(sexta.status).toBe(429);

    await apagarUsuariosTeste(emailsCriados);
  });
});
