import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { gerarTokenRedefinicaoSenha, gerarTokenVerificacaoEmail } from "@/lib/token";
import { ClienteAuthGateway, criarVerificadorDeToken, type Tokens } from "../../sdk/src";
import {
  apagarAplicacoesTeste,
  BASE_URL,
  criarAplicacaoTeste,
  gerarEmailTeste,
  ipAleatorio,
  SENHA_TESTE,
  type AplicacaoTeste,
} from "../helpers";

// O SDK de ponta a ponta contra o servidor real, do jeito que o backend de um
// cliente usaria: com client secret e tokens no corpo, sem cookies.

const aplicacoesCriadas: string[] = [];

afterAll(async () => {
  await apagarAplicacoesTeste(aplicacoesCriadas);
});

async function novaAplicacao(): Promise<AplicacaoTeste> {
  const aplicacao = await criarAplicacaoTeste("Cliente do SDK");
  aplicacoesCriadas.push(aplicacao.id);
  return aplicacao;
}

function cliente(aplicacao: AplicacaoTeste) {
  let tokens: Tokens | null = null;
  const ip = ipAleatorio();
  const sdk = new ClienteAuthGateway({
    urlBase: BASE_URL,
    clientId: aplicacao.clientId,
    clientSecret: aplicacao.clientSecret,
    armazenamento: { ler: () => tokens, gravar: (t) => { tokens = t; } },
    // IP próprio por cliente, pelo mesmo motivo de tests/helpers.ts.
    fetch: (url, init) =>
      fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), "X-Forwarded-For": ip } }),
  });
  return { sdk, tokens: () => tokens };
}

describe("SDK (sdk/src)", () => {
  it("cadastra, entra, lê o usuário, renova e sai", async () => {
    const aplicacao = await novaAplicacao();
    const { sdk, tokens } = cliente(aplicacao);
    const email = gerarEmailTeste("sdk-fluxo");

    await sdk.cadastrar({ nome: "Pessoa do SDK", email, senha: SENHA_TESTE });
    const login = await sdk.entrar({ email, senha: SENHA_TESTE });
    expect(login.mfaObrigatorio).toBe(false);

    const usuario = await sdk.usuarioAtual();
    expect(usuario?.email).toBe(email);

    const antes = tokens()!.tokenAtualizacao;
    expect(await sdk.renovar()).toBe(true);
    expect(tokens()!.tokenAtualizacao).not.toBe(antes);

    const refreshDaSessao = tokens()!.tokenAtualizacao;
    await sdk.sair();
    expect(tokens()).toBeNull();

    // A sessão foi revogada no provedor, não só esquecida localmente.
    const renovarDepois = await fetch(`${BASE_URL}/api/auth/atualizar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ipAleatorio() },
      body: JSON.stringify({ tokenAtualizacao: refreshDaSessao }),
    });
    expect(renovarDepois.status).toBe(401);
  });

  it("renovações simultâneas viram uma só (cada refresh token vale uma vez)", async () => {
    const aplicacao = await novaAplicacao();
    const { sdk } = cliente(aplicacao);
    const email = gerarEmailTeste("sdk-renovar-junto");
    await sdk.cadastrar({ nome: "Pessoa do SDK", email, senha: SENHA_TESTE });
    await sdk.entrar({ email, senha: SENHA_TESTE });

    const resultados = await Promise.all([sdk.renovar(), sdk.renovar(), sdk.renovar()]);
    expect(resultados).toEqual([true, true, true]);
    expect(await sdk.usuarioAtual()).not.toBeNull();
  });

  it("duas instâncias com o mesmo armazenamento (duas abas) renovando juntas não se deslogam", async () => {
    // Antes: a instância que perdia a corrida recebia 401 e apagava o par novo
    // que a outra tinha acabado de gravar — as duas abas saíam.
    const aplicacao = await novaAplicacao();
    const aba1 = cliente(aplicacao);
    const email = gerarEmailTeste("sdk-duas-abas");
    await aba1.sdk.cadastrar({ nome: "Pessoa do SDK", email, senha: SENHA_TESTE });
    await aba1.sdk.entrar({ email, senha: SENHA_TESTE });

    let tokens = aba1.tokens();
    const compartilhado = {
      ler: () => tokens,
      gravar: (t: Tokens | null) => {
        tokens = t;
      },
    };
    const ip = ipAleatorio();
    const abas = [0, 1].map(
      () =>
        new ClienteAuthGateway({
          urlBase: BASE_URL,
          clientId: aplicacao.clientId,
          clientSecret: aplicacao.clientSecret,
          armazenamento: compartilhado,
          fetch: (url, init) =>
            fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), "X-Forwarded-For": ip } }),
        }),
    );

    const antes = tokens!.tokenAtualizacao;
    expect(await Promise.all(abas.map((aba) => aba.renovar()))).toEqual([true, true]);
    expect(tokens).not.toBeNull();
    expect(tokens!.tokenAtualizacao).not.toBe(antes);
    expect(await abas[0].usuarioAtual()).not.toBeNull();
    expect(await abas[1].usuarioAtual()).not.toBeNull();

    const conta = await prisma.usuario.findFirstOrThrow({ where: { email, aplicacaoId: aplicacao.id } });
    const alarme = await prisma.logAuditoria.findFirst({
      where: { usuarioId: conta.id, evento: "reuso_token_detectado" },
    });
    expect(alarme).toBeNull();
  });

  it("o verificador de backend aceita o token da aplicação e recusa o de outra", async () => {
    const aplicacaoA = await novaAplicacao();
    const aplicacaoB = await novaAplicacao();
    const { sdk, tokens } = cliente(aplicacaoA);
    const email = gerarEmailTeste("sdk-verificador");
    await sdk.cadastrar({ nome: "Pessoa do SDK", email, senha: SENHA_TESTE });
    await sdk.entrar({ email, senha: SENHA_TESTE });

    const verificarA = criarVerificadorDeToken({ urlBase: BASE_URL, audiencia: aplicacaoA.id });
    const claims = await verificarA(tokens()!.tokenAcesso);
    expect(claims.email).toBe(email);
    expect(claims.aplicacaoId).toBe(aplicacaoA.id);

    const verificarB = criarVerificadorDeToken({ urlBase: BASE_URL, audiencia: aplicacaoB.id });
    await expect(verificarB(tokens()!.tokenAcesso)).rejects.toThrow();
  });

  it("conclui os links de e-mail: verificar e-mail e redefinir senha", async () => {
    const aplicacao = await novaAplicacao();
    const { sdk } = cliente(aplicacao);
    const email = gerarEmailTeste("sdk-links");
    await sdk.cadastrar({ nome: "Pessoa do SDK", email, senha: SENHA_TESTE });
    const conta = await prisma.usuario.findFirstOrThrow({ where: { email, aplicacaoId: aplicacao.id } });

    await sdk.verificarEmail(await gerarTokenVerificacaoEmail(conta.id));
    expect((await prisma.usuario.findUniqueOrThrow({ where: { id: conta.id } })).emailVerificado).toBe(true);

    const novaSenha = "OutraSenhaDoSdk456!";
    await sdk.redefinirSenha(await gerarTokenRedefinicaoSenha(conta.id), novaSenha);
    const login = await sdk.entrar({ email, senha: novaSenha });
    expect(login.mfaObrigatorio).toBe(false);
  });

  it("erros chegam como ErroAuthGateway com status", async () => {
    const aplicacao = await novaAplicacao();
    const { sdk } = cliente(aplicacao);
    await expect(
      sdk.entrar({ email: gerarEmailTeste("sdk-nao-existe"), senha: SENHA_TESTE }),
    ).rejects.toMatchObject({ name: "ErroAuthGateway", status: 401 });
  });
});
