import * as OTPAuth from "otpauth";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  apagarUsuariosTeste,
  BASE_URL,
  criarUsuarioTeste,
  ipAleatorio,
  loginTeste,
} from "../helpers";

const emailsCriados: string[] = [];

// offsetPeriodos permite gerar o código de um timestep diferente do atual —
// necessário quando um teste precisa de DOIS códigos válidos em sequência
// rápida (ex.: confirmar + desativar): sem isso, os dois `totp.generate()`
// cairiam no mesmo timestep (o teste roda bem mais rápido que os 30s de
// período) e o segundo seria rejeitado como replay do primeiro — a própria
// proteção que este código de produção agora aplica.
function gerarCodigoTotp(segredoBase32: string, offsetPeriodos = 0): string {
  const totp = new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(segredoBase32),
  });
  return totp.generate({ timestamp: Date.now() + offsetPeriodos * 30_000 });
}

// As rotas de MFA têm rate limit por IP (mfa_codigo_falha) — cada teste usa
// um IP falso próprio pra não interferir com outros testes que também
// batem nessas rotas em paralelo (mesmo princípio de tests/helpers.ts).
async function chamar(
  caminho: string,
  headers: Record<string, string>,
  corpo?: object,
  ip: string = ipAleatorio(),
) {
  return fetch(`${BASE_URL}${caminho}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip, ...headers },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
}

describe("Fluxo de MFA (TOTP)", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("iniciar → confirmar ativa o MFA", async () => {
    const usuario = await criarUsuarioTeste("mfa-ativar");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    // Antes de ativar o MFA, /me não expõe contagem de códigos de backup
    // (não existem códigos pra quem nunca ativou).
    const respostaMeAntes = await fetch(`${BASE_URL}/api/auth/me`, { headers: cabecalhos });
    const corpoMeAntes = await respostaMeAntes.json();
    expect(corpoMeAntes.usuario.codigosBackupRestantes).toBeNull();

    const respostaIniciar = await chamar("/api/auth/mfa/iniciar", cabecalhos);
    expect(respostaIniciar.status).toBe(200);
    const { segredo } = await respostaIniciar.json();
    expect(segredo).toBeTruthy();

    const respostaConfirmar = await chamar("/api/auth/mfa/confirmar", cabecalhos, {
      codigo: gerarCodigoTotp(segredo),
    });
    expect(respostaConfirmar.status).toBe(200);
    const corpoConfirmar = await respostaConfirmar.json();
    // Códigos de backup são emitidos nesse exato momento — única vez que
    // aparecem em texto puro.
    expect(corpoConfirmar.codigosBackup).toHaveLength(10);
    expect(new Set(corpoConfirmar.codigosBackup).size).toBe(10);

    // Confirma pelo /me que mfaAtivado agora é true e que a contagem de
    // códigos de backup restantes aparece (10, nenhum consumido ainda).
    const respostaMe = await fetch(`${BASE_URL}/api/auth/me`, { headers: cabecalhos });
    const corpoMe = await respostaMe.json();
    expect(corpoMe.usuario.mfaAtivado).toBe(true);
    expect(corpoMe.usuario.codigosBackupRestantes).toBe(10);
  });

  it("rejeita código incorreto na confirmação", async () => {
    const usuario = await criarUsuarioTeste("mfa-codigo-errado");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    await chamar("/api/auth/mfa/iniciar", cabecalhos);
    const resposta = await chamar("/api/auth/mfa/confirmar", cabecalhos, {
      codigo: "000000",
    });

    expect(resposta.status).toBe(401);
  });

  it("desativa o MFA com um código válido", async () => {
    const usuario = await criarUsuarioTeste("mfa-desativar");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const respostaIniciar = await chamar("/api/auth/mfa/iniciar", cabecalhos);
    const { segredo } = await respostaIniciar.json();
    await chamar("/api/auth/mfa/confirmar", cabecalhos, { codigo: gerarCodigoTotp(segredo) });

    const respostaDesativar = await chamar("/api/auth/mfa/desativar", cabecalhos, {
      codigo: gerarCodigoTotp(segredo, 1),
    });
    expect(respostaDesativar.status).toBe(200);

    const respostaMe = await fetch(`${BASE_URL}/api/auth/me`, { headers: cabecalhos });
    const corpoMe = await respostaMe.json();
    expect(corpoMe.usuario.mfaAtivado).toBe(false);
  });

  it("desativar o MFA invalida todos os códigos de backup", async () => {
    const usuario = await criarUsuarioTeste("mfa-desativar-invalida-backup");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const respostaIniciar = await chamar("/api/auth/mfa/iniciar", cabecalhos);
    const { segredo } = await respostaIniciar.json();
    const respostaConfirmar = await chamar("/api/auth/mfa/confirmar", cabecalhos, {
      codigo: gerarCodigoTotp(segredo),
    });
    const { codigosBackup } = await respostaConfirmar.json();

    await chamar("/api/auth/mfa/desativar", cabecalhos, {
      codigo: gerarCodigoTotp(segredo, 1),
    });

    // Reativa o MFA com um segredo novo — os códigos de backup do MFA
    // anterior não devem continuar valendo pro novo.
    const respostaIniciar2 = await chamar("/api/auth/mfa/iniciar", cabecalhos);
    const { segredo: segredo2 } = await respostaIniciar2.json();
    // mfaUltimoTimestep é por USUÁRIO (sobe com o relógio, não reseta ao
    // trocar de segredo) — um offset simples não dá conta aqui: qualquer
    // timestep adiante o bastante pra não colidir com o já usado no
    // desativar cai fora da janela de tolerância (±1 período) do TOTP em
    // relação ao instante real da validação. Resetar direto no banco simula
    // a passagem real de tempo (o que aconteceria de verdade entre
    // desativar e reativar o MFA num uso normal) sem esperar 30s de verdade.
    await prisma.usuario.update({
      where: { email: usuario.email },
      data: { mfaUltimoTimestep: null },
    });
    await chamar("/api/auth/mfa/confirmar", cabecalhos, {
      codigo: gerarCodigoTotp(segredo2),
    });

    const loginMfa = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ipAleatorio() },
      body: JSON.stringify({ email: usuario.email, senha: usuario.senha }),
    });
    const { mfaToken } = await loginMfa.json();

    const respostaBackupAntigo = await chamar("/api/auth/mfa/backup", {}, {
      mfaToken,
      codigo: codigosBackup[0],
    });
    expect(respostaBackupAntigo.status).toBe(401);

    const usuarioDb = await prisma.usuario.findUniqueOrThrow({ where: { email: usuario.email } });
    const log = await prisma.logAuditoria.findFirst({
      where: { usuarioId: usuarioDb.id, evento: "codigos_backup_invalidados" },
    });
    expect(log).not.toBeNull();
  });

  it("rejeita o mesmo código TOTP usado duas vezes (replay dentro da janela de 30s)", async () => {
    const usuario = await criarUsuarioTeste("mfa-replay-totp");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const respostaIniciar = await chamar("/api/auth/mfa/iniciar", cabecalhos);
    const { segredo } = await respostaIniciar.json();
    const codigo = gerarCodigoTotp(segredo);

    const primeiraConfirmacao = await chamar("/api/auth/mfa/confirmar", cabecalhos, { codigo });
    expect(primeiraConfirmacao.status).toBe(200);

    // /mfa/confirmar já ativou o MFA; usar o MESMO código de novo em
    // /mfa/desativar (mesmo endpoint que consome TOTP) deve ser rejeitado
    // como replay, mesmo sendo um código que "seria válido" pelo relógio.
    const segundaTentativa = await chamar("/api/auth/mfa/desativar", cabecalhos, { codigo });
    expect(segundaTentativa.status).toBe(401);

    // Confirma que o MFA continua ativado (a tentativa de desativar falhou de verdade).
    const respostaMe = await fetch(`${BASE_URL}/api/auth/me`, { headers: cabecalhos });
    const corpoMe = await respostaMe.json();
    expect(corpoMe.usuario.mfaAtivado).toBe(true);
  });

  it("o mfaToken de desafio é de uso único: uma segunda conclusão com o mesmo token falha", async () => {
    const usuario = await criarUsuarioTeste("mfa-desafio-uso-unico");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const respostaIniciar = await chamar("/api/auth/mfa/iniciar", cabecalhos);
    const { segredo } = await respostaIniciar.json();
    await chamar("/api/auth/mfa/confirmar", cabecalhos, { codigo: gerarCodigoTotp(segredo) });

    const respostaLogin = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ipAleatorio() },
      body: JSON.stringify({ email: usuario.email, senha: usuario.senha }),
    });
    const { mfaToken } = await respostaLogin.json();
    expect(mfaToken).toBeTruthy();

    const primeiraConclusao = await chamar("/api/auth/mfa/verificar", {}, {
      mfaToken,
      codigo: gerarCodigoTotp(segredo, 1),
    });
    expect(primeiraConclusao.status).toBe(200);

    // Reseta mfaUltimoTimestep pra isolar o que este teste quer provar: o
    // código da segunda tentativa é, por si só, perfeitamente válido pelo
    // TOTP (não é replay de código) — quem tem que rejeitar é o jti do
    // mfaToken já ter sido consumido na conclusão anterior.
    await prisma.usuario.update({
      where: { email: usuario.email },
      data: { mfaUltimoTimestep: null },
    });
    const segundaConclusao = await chamar("/api/auth/mfa/verificar", {}, {
      mfaToken,
      codigo: gerarCodigoTotp(segredo),
    });
    expect(segundaConclusao.status).toBe(401);
  });

  it("rejeita no login um código TOTP já usado em outro login (replay em /mfa/verificar)", async () => {
    const usuario = await criarUsuarioTeste("mfa-login-replay");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const respostaIniciar = await chamar("/api/auth/mfa/iniciar", cabecalhos);
    const { segredo } = await respostaIniciar.json();
    await chamar("/api/auth/mfa/confirmar", cabecalhos, { codigo: gerarCodigoTotp(segredo) });

    // Primeiro login completo com um código fresco (period seguinte, pra não
    // colidir com o código já consumido em /mfa/confirmar).
    const primeiroLogin = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ipAleatorio() },
      body: JSON.stringify({ email: usuario.email, senha: usuario.senha }),
    });
    const { mfaToken: primeiroToken } = await primeiroLogin.json();
    const codigoReutilizado = gerarCodigoTotp(segredo, 1);
    const primeiraVerificacao = await chamar("/api/auth/mfa/verificar", {}, {
      mfaToken: primeiroToken,
      codigo: codigoReutilizado,
    });
    expect(primeiraVerificacao.status).toBe(200);

    // Segundo login (novo desafio/mfaToken), tentando completar com o MESMO
    // código TOTP já aceito no login anterior — precisa ser rejeitado como
    // replay, mesmo com um jti de desafio novo e ainda dentro da janela do
    // relógio em que o código "seria válido".
    const segundoLogin = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ipAleatorio() },
      body: JSON.stringify({ email: usuario.email, senha: usuario.senha }),
    });
    const { mfaToken: segundoToken } = await segundoLogin.json();
    expect(segundoToken).toBeTruthy();
    expect(segundoToken).not.toBe(primeiroToken);

    const segundaVerificacao = await chamar("/api/auth/mfa/verificar", {}, {
      mfaToken: segundoToken,
      codigo: codigoReutilizado,
    });
    expect(segundaVerificacao.status).toBe(401);
    const corpoErro = await segundaVerificacao.json();
    expect(corpoErro.erro).toBe("Código inválido.");
  });

  it("rejeita no login um código TOTP expirado (fora da janela de tolerância de ±30s)", async () => {
    const usuario = await criarUsuarioTeste("mfa-login-expirado");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const respostaIniciar = await chamar("/api/auth/mfa/iniciar", cabecalhos);
    const { segredo } = await respostaIniciar.json();
    await chamar("/api/auth/mfa/confirmar", cabecalhos, { codigo: gerarCodigoTotp(segredo) });

    const respostaLogin = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ipAleatorio() },
      body: JSON.stringify({ email: usuario.email, senha: usuario.senha }),
    });
    const { mfaToken } = await respostaLogin.json();
    expect(mfaToken).toBeTruthy();

    // 10 períodos (5 minutos) atrás — bem fora da janela de tolerância de
    // ±1 período (±30s) aceita por verificarCodigoMfa/mfa.ts.
    const codigoExpirado = gerarCodigoTotp(segredo, -10);
    const resposta = await chamar("/api/auth/mfa/verificar", {}, {
      mfaToken,
      codigo: codigoExpirado,
    });
    expect(resposta.status).toBe(401);
    const corpoErro = await resposta.json();
    expect(corpoErro.erro).toBe("Código inválido.");

    // O desafio (mfaToken) continua de pé — um código expirado/errado não
    // pode "gastar" a tentativa de login, só um código correto consome o jti.
    const codigoValido = gerarCodigoTotp(segredo, 1);
    const respostaValida = await chamar("/api/auth/mfa/verificar", {}, {
      mfaToken,
      codigo: codigoValido,
    });
    expect(respostaValida.status).toBe(200);
  });

  // Regressão de um incidente real: MFA_ENCRYPTION_KEY_ANTERIOR configurada
  // errada em produção deixou o mfaSecret de uma conta indecifrável (nem a
  // chave atual nem a anterior batiam). Sem tratamento, descriptografar()
  // lançava sem try/catch e a rota crashava com corpo vazio — o cliente via
  // "Unexpected end of JSON input" em vez de um erro decente. Simula a mesma
  // situação corrompendo o mfaSecret direto no banco.
  it("responde 500 com JSON (não crasha) quando o mfaSecret armazenado está indecifrável", async () => {
    const usuario = await criarUsuarioTeste("mfa-segredo-indecifravel");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const respostaIniciar = await chamar("/api/auth/mfa/iniciar", cabecalhos);
    const { segredo } = await respostaIniciar.json();
    await chamar("/api/auth/mfa/confirmar", cabecalhos, { codigo: gerarCodigoTotp(segredo) });

    await prisma.usuario.update({
      where: { email: usuario.email },
      data: { mfaSecret: "v1:aWx1bWluYWRv:c2VncmVkbw==:ZGFkb3M=" },
    });

    const respostaLogin = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ipAleatorio() },
      body: JSON.stringify({ email: usuario.email, senha: usuario.senha }),
    });
    const { mfaToken } = await respostaLogin.json();
    expect(mfaToken).toBeTruthy();

    const resposta = await chamar("/api/auth/mfa/verificar", {}, {
      mfaToken,
      codigo: "000000",
    });
    expect(resposta.status).toBe(500);
    const corpo = await resposta.json();
    expect(corpo.erro).toBeTruthy();
  });
});
