import "server-only";

import bcrypt from "bcryptjs";

const RODADAS_DE_SAL = 12;

export async function gerarHashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, RODADAS_DE_SAL);
}

export async function verificarSenha(
  senha: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(senha, hash);
}
