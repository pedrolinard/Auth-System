import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  apagarUsuariosTeste,
  BASE_URL,
  gerarEmailTeste,
  ipAleatorio,
  SENHA_TESTE,
} from "../helpers";

const emailsCriados: string[] = [];

function proximoEmail(prefixo: string) {
  const email = gerarEmailTeste(prefixo);
  emailsCriados.push(email);
  return email;
}

async function cadastrar(dados: Record<string, unknown>, ip = ipAleatorio()) {
  return fetch(`${BASE_URL}/api/auth/cadastro`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify(dados),
  });
}

describe("POST /api/auth/cadastro", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("cria um usuário novo", async () => {
    const email = proximoEmail("cadastro-sucesso");
    const resposta = await cadastrar({ nome: "Teste", email, senha: SENHA_TESTE });

    expect(resposta.status).toBe(201);
    const corpo = await resposta.json();
    // Não devolve o usuário: esses campos só existiriam pra conta nova.
    expect(corpo.usuario).toBeUndefined();
    const usuario = await prisma.usuario.findFirst({ where: { email } });
    expect(usuario).not.toBeNull();
  });

  it("e-mail já cadastrado recebe a MESMA resposta de um cadastro novo (anti-enumeração)", async () => {
    const email = proximoEmail("cadastro-duplicado");
    const novo = await cadastrar({ nome: "Teste", email, senha: SENHA_TESTE });
    const corpoNovo = await novo.json();
    const contaOriginal = await prisma.usuario.findFirstOrThrow({ where: { email } });

    const duplicado = await cadastrar({ nome: "Outro Nome", email, senha: "OutraSenhaForte456!" });

    expect(duplicado.status).toBe(novo.status);
    expect(await duplicado.json()).toEqual(corpoNovo);

    // A conta original não foi tocada: nem nome, nem senha.
    const contaDepois = await prisma.usuario.findFirstOrThrow({ where: { email } });
    expect(contaDepois.nome).toBe(contaOriginal.nome);
    expect(contaDepois.senhaHash).toBe(contaOriginal.senhaHash);
    expect(await prisma.usuario.count({ where: { email } })).toBe(1);

    const aviso = await prisma.logAuditoria.findFirst({
      where: { evento: "cadastro_conta_existente", email },
    });
    expect(aviso).not.toBeNull();
  });

  it("rejeita dados inválidos com 400", async () => {
    const resposta = await cadastrar({ nome: "T", email: "invalido", senha: "123" });
    expect(resposta.status).toBe(400);
  });

  it("rejeita senha com mais de 72 bytes (limite de truncamento do bcrypt)", async () => {
    const email = proximoEmail("cadastro-senha-longa");
    const senhaGigante = `Senha1${"a".repeat(70)}`; // 76 bytes ASCII
    const resposta = await cadastrar({ nome: "Teste", email, senha: senhaGigante });
    expect(resposta.status).toBe(400);
  });

  it("aceita senha de exatamente 72 bytes ASCII", async () => {
    const email = proximoEmail("cadastro-senha-72");
    const senhaNoLimite = `Senha1${"a".repeat(66)}`; // 72 bytes ASCII
    expect(Buffer.byteLength(senhaNoLimite, "utf8")).toBe(72);
    const resposta = await cadastrar({ nome: "Teste", email, senha: senhaNoLimite });
    expect(resposta.status).toBe(201);
  });

  it("rejeita senha curta em caracteres mas longa em bytes (acentos contam 2+)", async () => {
    const email = proximoEmail("cadastro-senha-multibyte");
    // 40 caracteres, mas 78 bytes UTF-8 — o `.max(72)` do Zod (que conta
    // caracteres) deixaria passar e o bcrypt truncaria em silêncio.
    const senhaMultibyte = `a1${"é".repeat(38)}`;
    expect(senhaMultibyte).toHaveLength(40);
    expect(Buffer.byteLength(senhaMultibyte, "utf8")).toBeGreaterThan(72);
    const resposta = await cadastrar({ nome: "Teste", email, senha: senhaMultibyte });
    expect(resposta.status).toBe(400);
  });

  it("rejeita senha conhecida em vazamentos (Have I Been Pwned)", async () => {
    const email = proximoEmail("cadastro-senha-vazada");
    // "Password1" está entre as senhas mais comuns em vazamentos reais — serve
    // de fixture estável pra exercitar a checagem contra a API real do HIBP.
    const resposta = await cadastrar({ nome: "Teste", email, senha: "Password1" });
    expect(resposta.status).toBe(400);
  });
});
