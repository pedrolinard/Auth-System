import "server-only";

import { randomInt } from "node:crypto";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/token";

const QUANTIDADE_CODIGOS = 10;
const TAMANHO_CODIGO = 10;

// Alfabeto base32 (A-Z + 2-7) sem os caracteres ambíguos O/0, I/1, L — evita
// erro de transcrição quando o usuário copia o código à mão (ex.: anotado em
// papel). 29 símbolos → ~4,86 bits/caractere × 10 caracteres ≈ 48,6 bits de
// entropia por código (perto dos ~50 bits pedidos).
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ234567";

function gerarUmCodigo(): string {
  let bruto = "";
  for (let i = 0; i < TAMANHO_CODIGO; i++) {
    // randomInt faz rejection sampling internamente (crypto.randomInt do
    // node:crypto) — evita o viés de módulo que rolaria com
    // Math.random() % alfabeto.length ou um simples `% length` sobre bytes
    // aleatórios, já que 29 não é potência de 2.
    bruto += ALFABETO[randomInt(ALFABETO.length)];
  }
  return `${bruto.slice(0, 5)}-${bruto.slice(5)}`;
}

// Gera o conjunto de códigos em texto puro. Não toca no banco — quem chama
// decide o que fazer com eles (persistir hash, exibir, etc.).
export function gerarCodigosBackup(): string[] {
  return Array.from({ length: QUANTIDADE_CODIGOS }, gerarUmCodigo);
}

// Normaliza (maiúsculas, sem hífen/espaços) antes de hashear — assim o
// usuário pode digitar "a7k9m3pxq2", "A7K9M-3PXQ2" ou "A7K9M 3PXQ2" que todos
// batem com o mesmo hash salvo.
function normalizarCodigo(codigo: string): string {
  return codigo.toUpperCase().replace(/[-\s]/g, "");
}

// SHA-256 (mesmo hashToken usado em TokenAtualizacao) em vez de um hash
// lento tipo bcrypt: o código já tem alta entropia (~50 bits) e uso único
// com rate limit no consumo, então não precisa do custo computacional de um
// hash de senha — o que importa aqui é permitir um lookup indexado direto
// pelo hash (WHERE codigoHash = ?), impraticável com bcrypt (salt aleatório
// por registro impede indexar/buscar diretamente pelo hash).
export function hashCodigo(codigo: string): string {
  return hashToken(normalizarCodigo(codigo));
}

// Gera um conjunto novo e persiste os hashes — usado tanto na ativação do
// MFA (passo 3) quanto na regeneração (passo 5). Retorna os códigos em
// texto puro: é a única vez que eles existem fora do processo de geração.
export async function persistirCodigosBackup(usuarioId: string): Promise<string[]> {
  const codigos = gerarCodigosBackup();

  await prisma.codigoBackupMfa.createMany({
    data: codigos.map((codigo) => ({
      usuarioId,
      codigoHash: hashCodigo(codigo),
    })),
  });

  return codigos;
}

// Apaga todos os códigos de backup do usuário — usado ao desativar o MFA
// (não faz sentido manter recovery codes de um segundo fator que não existe
// mais) e antes de gerar um conjunto novo na regeneração (o conjunto antigo
// não deve continuar valendo).
export async function invalidarCodigosBackup(usuarioId: string): Promise<void> {
  await prisma.codigoBackupMfa.deleteMany({ where: { usuarioId } });
}

// Consome um código: procura o hash correspondente ainda não usado e marca
// usadoEm atomicamente. O updateMany condicionado a `usadoEm: null` vira um
// único UPDATE no Postgres — duas requisições concorrentes tentando
// consumir o mesmo código serializam no lock de linha, e só a primeira
// encontra a linha com usadoEm ainda nulo (a segunda, ao reavaliar o WHERE
// depois de esperar o lock, já não bate mais). Isso evita o mesmo código
// ser aceito duas vezes por uma corrida entre requests simultâneos.
export async function consumirCodigoBackup(
  usuarioId: string,
  codigoDigitado: string,
): Promise<boolean> {
  const { count } = await prisma.codigoBackupMfa.updateMany({
    where: { usuarioId, codigoHash: hashCodigo(codigoDigitado), usadoEm: null },
    data: { usadoEm: new Date() },
  });

  return count === 1;
}

// Quantos códigos ainda não foram usados — suporte à UI avisar o usuário
// quando o estoque estiver acabando.
export async function contarCodigosRestantes(usuarioId: string): Promise<number> {
  return prisma.codigoBackupMfa.count({ where: { usuarioId, usadoEm: null } });
}
