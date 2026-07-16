import "server-only";

import { createHash } from "node:crypto";
import { SignJWT, jwtVerify, errors, importPKCS8, importSPKI } from "jose";

let chavePrivadaAcesso: Promise<CryptoKey> | null = null;
function obterChavePrivadaAcesso() {
  if (!chavePrivadaAcesso) {
    const pem = Buffer.from(
      process.env.JWT_ACCESS_PRIVATE_KEY_B64!,
      "base64",
    ).toString("utf8");
    chavePrivadaAcesso = importPKCS8(pem, "RS256");
  }
  return chavePrivadaAcesso;
}

let chavePublicaAcesso: Promise<CryptoKey> | null = null;
function obterChavePublicaAcesso() {
  if (!chavePublicaAcesso) {
    const pem = Buffer.from(
      process.env.JWT_ACCESS_PUBLIC_KEY_B64!,
      "base64",
    ).toString("utf8");
    chavePublicaAcesso = importSPKI(pem, "RS256");
  }
  return chavePublicaAcesso;
}

const SEGREDO_ATUALIZACAO = new TextEncoder().encode(
  process.env.JWT_REFRESH_SECRET,
);
const SEGREDO_MFA = new TextEncoder().encode(process.env.JWT_MFA_SECRET);
const SEGREDO_VERIFICACAO_EMAIL = new TextEncoder().encode(
  process.env.JWT_VERIFICACAO_EMAIL_SECRET,
);
const SEGREDO_REDEFINICAO_SENHA = new TextEncoder().encode(
  process.env.JWT_REDEFINICAO_SENHA_SECRET,
);

export const DURACAO_TOKEN_ACESSO = "15m";
export const DURACAO_TOKEN_ACESSO_SEGUNDOS = 15 * 60;
export const DURACAO_TOKEN_ATUALIZACAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
export const DURACAO_TOKEN_DESAFIO_MFA = "5m";
export const DURACAO_TOKEN_VERIFICACAO_EMAIL = "1d";
export const DURACAO_TOKEN_REDEFINICAO_SENHA = "1h";

export type Papel = "usuario" | "admin";

export type PayloadTokenAcesso = {
  sub: string;
  email: string;
  papel: Papel;
};

export type PayloadTokenAtualizacao = {
  sub: string;
  jti: string;
};

export type PayloadDesafioMfa = {
  sub: string;
  tipo: "mfa_desafio";
};

export type PayloadVerificacaoEmail = {
  sub: string;
  tipo: "verificacao_email";
};

export type PayloadRedefinicaoSenha = {
  sub: string;
  tipo: "redefinicao_senha";
};

if (
  !process.env.JWT_ACCESS_PRIVATE_KEY_B64 ||
  !process.env.JWT_ACCESS_PUBLIC_KEY_B64 ||
  !process.env.JWT_REFRESH_SECRET ||
  !process.env.JWT_MFA_SECRET ||
  !process.env.JWT_VERIFICACAO_EMAIL_SECRET ||
  !process.env.JWT_REDEFINICAO_SENHA_SECRET ||
  !process.env.MFA_ENCRYPTION_KEY
) {
  throw new Error(
    "As variáveis de ambiente JWT_ACCESS_PRIVATE_KEY_B64, JWT_ACCESS_PUBLIC_KEY_B64, JWT_REFRESH_SECRET, JWT_MFA_SECRET, JWT_VERIFICACAO_EMAIL_SECRET, JWT_REDEFINICAO_SENHA_SECRET e MFA_ENCRYPTION_KEY precisam estar definidas.",
  );
}

export async function gerarTokenAcesso(payload: PayloadTokenAcesso) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setExpirationTime(DURACAO_TOKEN_ACESSO)
    .sign(await obterChavePrivadaAcesso());
}

export async function verificarTokenAcesso(token: string) {
  try {
    const { payload } = await jwtVerify<PayloadTokenAcesso>(
      token,
      await obterChavePublicaAcesso(),
      { algorithms: ["RS256"] },
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
      { algorithms: ["HS256"] },
    );
    return payload;
  } catch (erro) {
    if (erro instanceof errors.JOSEError) return null;
    throw erro;
  }
}

// Token de curta duração emitido após validar e-mail/senha quando o usuário
// tem MFA ativado. Não serve como token de acesso nem de atualização: usa um
// segredo próprio para evitar confusão entre os três tipos de token.
export async function gerarTokenDesafioMfa(usuarioId: string) {
  return new SignJWT({ sub: usuarioId, tipo: "mfa_desafio" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(DURACAO_TOKEN_DESAFIO_MFA)
    .sign(SEGREDO_MFA);
}

export async function verificarTokenDesafioMfa(token: string) {
  try {
    const { payload } = await jwtVerify<PayloadDesafioMfa>(token, SEGREDO_MFA, {
      algorithms: ["HS256"],
    });
    if (payload.tipo !== "mfa_desafio") return null;
    return payload;
  } catch (erro) {
    if (erro instanceof errors.JOSEError) return null;
    throw erro;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Token de verificação de e-mail: mesma ideia stateless do desafio MFA (não
// precisa de coluna extra pra hash/expiração — o próprio jose cuida disso
// via `exp`), com segredo próprio e vida mais longa (1 dia, já que é um
// fluxo assíncrono — o usuário confere o e-mail quando quiser).
export async function gerarTokenVerificacaoEmail(usuarioId: string) {
  return new SignJWT({ sub: usuarioId, tipo: "verificacao_email" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(DURACAO_TOKEN_VERIFICACAO_EMAIL)
    .sign(SEGREDO_VERIFICACAO_EMAIL);
}

export async function verificarTokenVerificacaoEmail(token: string) {
  try {
    const { payload } = await jwtVerify<PayloadVerificacaoEmail>(
      token,
      SEGREDO_VERIFICACAO_EMAIL,
      { algorithms: ["HS256"] },
    );
    if (payload.tipo !== "verificacao_email") return null;
    return payload;
  } catch (erro) {
    if (erro instanceof errors.JOSEError) return null;
    throw erro;
  }
}

// Token de redefinição de senha: mesmo padrão stateless, mas mais curto
// (1h) por ser sensível — um link de redefinição vivo por muito tempo é uma
// janela de ataque maior que um link de verificação de e-mail.
export async function gerarTokenRedefinicaoSenha(usuarioId: string) {
  return new SignJWT({ sub: usuarioId, tipo: "redefinicao_senha" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(DURACAO_TOKEN_REDEFINICAO_SENHA)
    .sign(SEGREDO_REDEFINICAO_SENHA);
}

export async function verificarTokenRedefinicaoSenha(token: string) {
  try {
    const { payload } = await jwtVerify<PayloadRedefinicaoSenha>(
      token,
      SEGREDO_REDEFINICAO_SENHA,
      { algorithms: ["HS256"] },
    );
    if (payload.tipo !== "redefinicao_senha") return null;
    return payload;
  } catch (erro) {
    if (erro instanceof errors.JOSEError) return null;
    throw erro;
  }
}
