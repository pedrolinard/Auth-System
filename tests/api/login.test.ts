import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  apagarUsuariosTeste,
  BASE_URL,
  criarUsuarioTeste,
  extrairCookie,
  gerarEmailTeste,
  ipAleatorio,
  SENHA_TESTE,
} from "../helpers";

const emailsCriados: string[] = [];

async function login(email: string, senha: string, ip = ipAleatorio()) {
  return fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ email, senha }),
  });
}

describe("POST /api/auth/login", () => {
  let email: string;

  beforeAll(async () => {
    const usuario = await criarUsuarioTeste("login");
    email = usuario.email;
    emailsCriados.push(email);
  });

  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("autentica com credenciais corretas e seta os três cookies httpOnly/CSRF", async () => {
    const resposta = await login(email, SENHA_TESTE);

    expect(resposta.status).toBe(200);
    expect(extrairCookie(resposta, "tokenAcesso")).toBeTruthy();
    expect(extrairCookie(resposta, "tokenAtualizacao")).toBeTruthy();
    expect(extrairCookie(resposta, "csrfToken")).toBeTruthy();
  });

  it("rejeita senha errada com mensagem genérica (401)", async () => {
    const resposta = await login(email, "SenhaErrada999");
    expect(resposta.status).toBe(401);
    const corpo = await resposta.json();
    expect(corpo.erro).toBe("E-mail ou senha inválidos.");
  });

  it("rejeita e-mail inexistente com a MESMA mensagem genérica (não vaza)", async () => {
    const resposta = await login(gerarEmailTeste("nao-existe"), "QualquerSenha1");
    expect(resposta.status).toBe(401);
    const corpo = await resposta.json();
    expect(corpo.erro).toBe("E-mail ou senha inválidos.");
  });

  it("e-mail inexistente e senha errada levam o mesmo tempo (sem side-channel de timing)", async () => {
    // bcrypt.compare domina o tempo da rota; se o e-mail inexistente pulasse
    // o bcrypt (curto-circuito), ele seria consistentemente muito mais
    // rápido que o caminho de senha errada — o que daria pra usar pra
    // enumerar e-mails cadastrados. Roda várias vezes e compara as médias
    // com uma margem folgada, já que timing em CI nunca é perfeitamente
    // estável.
    const REPETICOES = 8;

    async function tempoMedio(fazerChamada: () => Promise<Response>): Promise<number> {
      const tempos: number[] = [];
      for (let i = 0; i < REPETICOES; i++) {
        const inicio = performance.now();
        await fazerChamada();
        tempos.push(performance.now() - inicio);
      }
      return tempos.reduce((soma, t) => soma + t, 0) / tempos.length;
    }

    const tempoSenhaErrada = await tempoMedio(() => login(email, "SenhaErrada999"));
    const tempoEmailInexistente = await tempoMedio(() =>
      login(gerarEmailTeste("nao-existe-timing"), "QualquerSenha1"),
    );

    const razao =
      Math.max(tempoSenhaErrada, tempoEmailInexistente) /
      Math.min(tempoSenhaErrada, tempoEmailInexistente);
    expect(razao).toBeLessThan(3);
  });

  it("retorna mfaObrigatorio quando o usuário tem MFA ativado", async () => {
    const usuarioMfa = await criarUsuarioTeste("login-mfa");
    emailsCriados.push(usuarioMfa.email);
    await prisma.usuario.update({
      where: { email: usuarioMfa.email },
      data: { mfaAtivado: true, mfaSecret: "JBSWY3DPEHPK3PXP" },
    });

    const resposta = await login(usuarioMfa.email, usuarioMfa.senha);

    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(corpo.mfaObrigatorio).toBe(true);
    expect(corpo.mfaToken).toBeTruthy();
    // Login com MFA pendente não deve setar cookie de sessão ainda.
    expect(extrairCookie(resposta, "tokenAcesso")).toBeNull();
  });
});
