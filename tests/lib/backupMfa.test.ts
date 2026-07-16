import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  consumirCodigoBackup,
  contarCodigosRestantes,
  gerarCodigosBackup,
  hashCodigo,
  invalidarCodigosBackup,
  persistirCodigosBackup,
} from "@/lib/backupMfa";
import { apagarUsuariosTeste, criarUsuarioTeste } from "../helpers";

const emailsCriados: string[] = [];

async function criarUsuarioDeVerdade(prefixo: string) {
  const usuario = await criarUsuarioTeste(prefixo);
  emailsCriados.push(usuario.email);
  return prisma.usuario.findUniqueOrThrow({ where: { email: usuario.email } });
}

describe("Códigos de backup de MFA (src/lib/backupMfa.ts)", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("gerarCodigosBackup gera 10 códigos no formato XXXXX-XXXXX sem caracteres ambíguos", () => {
    const codigos = gerarCodigosBackup();
    expect(codigos).toHaveLength(10);

    const formato = /^[ABCDEFGHJKMNPQRSTUVWXYZ234567]{5}-[ABCDEFGHJKMNPQRSTUVWXYZ234567]{5}$/;
    for (const codigo of codigos) {
      expect(codigo).toMatch(formato);
      expect(codigo).not.toMatch(/[O0I1L]/);
    }

    // Não devem se repetir dentro do mesmo conjunto (espaço grande o
    // suficiente pra colisão em 10 sorteios ser praticamente impossível).
    expect(new Set(codigos).size).toBe(10);
  });

  it("hashCodigo normaliza maiúsculas/hífen/espaços antes de hashear", () => {
    const hashBase = hashCodigo("ABCDE-FGHJK");
    expect(hashCodigo("abcde-fghjk")).toBe(hashBase);
    expect(hashCodigo("ABCDEFGHJK")).toBe(hashBase);
    expect(hashCodigo("abcde fghjk")).toBe(hashBase);
    expect(hashCodigo("ABCDE-FGHJX")).not.toBe(hashBase);
  });

  it("persiste um conjunto novo, consome um código com sucesso e não deixa reusar", async () => {
    const usuario = await criarUsuarioDeVerdade("backup-consumo");
    const codigos = await persistirCodigosBackup(usuario.id);
    expect(codigos).toHaveLength(10);
    expect(await contarCodigosRestantes(usuario.id)).toBe(10);

    const primeiroConsumo = await consumirCodigoBackup(usuario.id, codigos[0]);
    expect(primeiroConsumo).toBe(true);
    expect(await contarCodigosRestantes(usuario.id)).toBe(9);

    // Mesmo código de novo: já foi usado, não pode validar de novo.
    const reuso = await consumirCodigoBackup(usuario.id, codigos[0]);
    expect(reuso).toBe(false);
    expect(await contarCodigosRestantes(usuario.id)).toBe(9);

    // Código nunca emitido: não valida.
    const codigoInventado = await consumirCodigoBackup(usuario.id, "ZZZZZ-ZZZZZ");
    expect(codigoInventado).toBe(false);
  });

  it("duas tentativas concorrentes com o MESMO código só deixam uma passar", async () => {
    const usuario = await criarUsuarioDeVerdade("backup-corrida");
    const codigos = await persistirCodigosBackup(usuario.id);

    const [resultadoA, resultadoB] = await Promise.all([
      consumirCodigoBackup(usuario.id, codigos[3]),
      consumirCodigoBackup(usuario.id, codigos[3]),
    ]);

    const sucessos = [resultadoA, resultadoB].filter(Boolean).length;
    expect(sucessos).toBe(1);
    expect(await contarCodigosRestantes(usuario.id)).toBe(9);
  });

  it("invalidarCodigosBackup apaga todos os códigos do usuário", async () => {
    const usuario = await criarUsuarioDeVerdade("backup-invalidar");
    const codigos = await persistirCodigosBackup(usuario.id);
    expect(await contarCodigosRestantes(usuario.id)).toBe(10);

    await invalidarCodigosBackup(usuario.id);

    expect(await contarCodigosRestantes(usuario.id)).toBe(0);
    expect(await consumirCodigoBackup(usuario.id, codigos[0])).toBe(false);
  });
});
