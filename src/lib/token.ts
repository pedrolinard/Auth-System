import "server-only";

import { createHash } from "node:crypto";
import { SignJWT, jwtVerify, errors } from "jose";

const SEGREDO_ACESSO = new TextEncoder().encode(
  process.env.JWT_ACCESS_SECRET,
);
const SEGREDO_ATUALIZACAO = new TextEncoder().encode(
  process.env.JWT_REFRESH_SECRET,
);

export const DURACAO_TOKEN_ACESSO = "15m";
export const DURACAO_TOKEN_ATUALIZACAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

export type PayloadTokenAcesso = {
  sub: string;
  email: string;
};

export type PayloadTokenAtualizacao = {
  sub: string;
  jti: string;
};

if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
  throw new Error(
    "As variáveis de ambiente JWT_ACCESS_SECRET e JWT_REFRESH_SECRET precisam estar definidas.",
  );
}

export async function gerarTokenAcesso(payload: PayloadTokenAcesso) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(DURACAO_TOKEN_ACESSO)
    .sign(SEGREDO_ACESSO);
}

export async function verificarTokenAcesso(token: string) {
  try {
    const { payload } = await jwtVerify<PayloadTokenAcesso>(
      token,
      SEGREDO_ACESSO,
    );
    return payload;
  } catch (erro) {
    if (erro instanceof errors.JOSEError) return null;
    throw erro;
  }
}

export async function gerarTokenAtualizacao(usuarioId: string) {
  const jti = crypto.randomUUID();
  const expiraEm = new Date(Date.now() + DURACAO_TOKEN_ATUALIZACAO_MS);

  const token = await new SignJWT({ sub: usuarioId, jti })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiraEm.getTime() / 1000))
    .sign(SEGREDO_ATUALIZACAO);

  return { token, jti, expiraEm };
}

export async function verificarTokenAtualizacao(token: string) {
  try {
    const { payload } = await jwtVerify<PayloadTokenAtualizacao>(
      token,
      SEGREDO_ATUALIZACAO,
    );
    return payload;
  } catch (erro) {
    if (erro instanceof errors.JOSEError) return null;
    throw erro;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
