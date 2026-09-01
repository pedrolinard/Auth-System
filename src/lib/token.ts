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
const SEGREDO_ALTERACAO_EMAIL = new TextEncoder().encode(
  process.env.JWT_ALTERACAO_EMAIL_SECRET,
);
const SEGREDO_PASSKEY = new TextEncoder().encode(process.env.JWT_PASSKEY_SECRET);

export const DURACAO_TOKEN_ACESSO = "15m";
export const DURACAO_TOKEN_ACESSO_SEGUNDOS = 15 * 60;

// Emissor do access token — carimbado na assinatura e checado na verificação
// (aqui e no serviço Django, ver django/comum/autenticacao.py). Amarra o
// token a este emissor: um JWT válido de outro contexto/produto que reusasse
// o mesmo par de chaves não passaria. Valor fixo (não é segredo, só rótulo).
//
// Só `iss`, sem `aud`: um verificador que NÃO espera `iss` simplesmente o
// ignora (compatível com qualquer consumidor antigo), enquanto um `aud`
// presente no token faz o PyJWT REJEITAR se o `decode` não passar
// `audience=` — o que quebraria todo consumidor até ele ser atualizado em
// sincronia. `iss` sozinho já cobre o cenário (emissor único, keypair
// dedicado).
export const EMISSOR_TOKEN_ACESSO = "auth-gateway";
export const DURACAO_TOKEN_ATUALIZACAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
export const DURACAO_TOKEN_DESAFIO_MFA = "5m";
export const DURACAO_TOKEN_DESAFIO_MFA_MS = 5 * 60 * 1000;
export const DURACAO_TOKEN_VERIFICACAO_EMAIL = "1d";
export const DURACAO_TOKEN_REDEFINICAO_SENHA = "1h";
export const DURACAO_TOKEN_ALTERACAO_EMAIL = "1h";
// Curta de propósito: é só a janela entre pedir o desafio WebAuthn (opções)
// e o browser devolver a resposta assinada — segundos na prática, mesmo
// contando a interação do usuário com o authenticator.
export const DURACAO_TOKEN_DESAFIO_PASSKEY = "2m";
export const DURACAO_TOKEN_DESAFIO_PASSKEY_MS = 2 * 60 * 1000;

export type Papel = "usuario" | "admin";

// Papel dentro da ORGANIZAÇÃO ativa da sessão — eixo separado do `papel` de
// sistema acima (Usuario.papel, inalterado). Um usuário pode ser "membro"
// numa organização e "admin" de sistema ao mesmo tempo.
export type PapelOrganizacao = "dono" | "admin" | "membro";

export type PayloadTokenAcesso = {
  sub: string;
  email: string;
  papel: Papel;
  // Organização ATIVA desta sessão — toda rota que opera em dados de
  // organização (projetos/tarefas no Django, gestão de membros) usa este
  // claim. Trocar de organização reemite o token (ver
  // POST /api/auth/organizacoes/[id]/entrar), não muda o claim de um token
  // já emitido.
  organizacaoId: string;
  papelOrganizacao: PapelOrganizacao;
};

export type PayloadTokenAtualizacao = {
  sub: string;
  jti: string;
};

export type PayloadDesafioMfa = {
  sub: string;
  tipo: "mfa_desafio";
  jti: string;
};

export type PayloadVerificacaoEmail = {
  sub: string;
  tipo: "verificacao_email";
};

export type PayloadRedefinicaoSenha = {
  sub: string;
  tipo: "redefinicao_senha";
};

export type PayloadAlteracaoEmail = {
  sub: string;
  tipo: "alteracao_email";
  novoEmail: string;
};

export type PayloadDesafioPasskey = {
  // Presente só no registro (usuário já autenticado, adicionando uma
  // passkey nova). Ausente no login: com credencial "descobrível" (resident
  // key), ainda não sabemos QUEM está logando até o browser devolver qual
  // credencial foi escolhida — é assim que o login sem digitar e-mail
  // funciona.
  sub?: string;
  challenge: string;
  tipo: "passkey_desafio";
  jti: string;
};

if (
  !process.env.JWT_ACCESS_PRIVATE_KEY_B64 ||
  !process.env.JWT_ACCESS_PUBLIC_KEY_B64 ||
  !process.env.JWT_REFRESH_SECRET ||
  !process.env.JWT_MFA_SECRET ||
  !process.env.JWT_VERIFICACAO_EMAIL_SECRET ||
  !process.env.JWT_REDEFINICAO_SENHA_SECRET ||
  !process.env.JWT_ALTERACAO_EMAIL_SECRET ||
  !process.env.JWT_PASSKEY_SECRET ||
  !process.env.MFA_ENCRYPTION_KEY
) {
  throw new Error(
    "As variáveis de ambiente JWT_ACCESS_PRIVATE_KEY_B64, JWT_ACCESS_PUBLIC_KEY_B64, JWT_REFRESH_SECRET, JWT_MFA_SECRET, JWT_VERIFICACAO_EMAIL_SECRET, JWT_REDEFINICAO_SENHA_SECRET, JWT_ALTERACAO_EMAIL_SECRET, JWT_PASSKEY_SECRET e MFA_ENCRYPTION_KEY precisam estar definidas.",
  );
}

export async function gerarTokenAcesso(payload: PayloadTokenAcesso) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setIssuer(EMISSOR_TOKEN_ACESSO)
    .setExpirationTime(DURACAO_TOKEN_ACESSO)
    .sign(await obterChavePrivadaAcesso());
}

export async function verificarTokenAcesso(token: string) {
  try {
    const { payload } = await jwtVerify<PayloadTokenAcesso>(
      token,
      await obterChavePublicaAcesso(),
      {
        algorithms: ["RS256"],
        issuer: EMISSOR_TOKEN_ACESSO,
      },
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
// segredo próprio para evitar confusão entre os três tipos de token. O jti
// permite consumir o desafio uma única vez (src/lib/desafioMfa.ts) — sem
// isso, o mesmo mfaToken poderia completar o login mais de uma vez dentro
// dos 5 minutos de validade.
export async function gerarTokenDesafioMfa(usuarioId: string) {
  const jti = crypto.randomUUID();
  const expiraEm = new Date(Date.now() + DURACAO_TOKEN_DESAFIO_MFA_MS);

  const token = await new SignJWT({ sub: usuarioId, tipo: "mfa_desafio", jti })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(DURACAO_TOKEN_DESAFIO_MFA)
    .sign(SEGREDO_MFA);

  return { token, jti, expiraEm };
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

// Token de alteração de e-mail: mesmo padrão stateless dos outros (1h de
// validade, como a redefinição de senha — também sensível). Carrega o
// `novoEmail` no próprio JWT em vez de reconsultar o banco na confirmação,
// então o link continua funcionando mesmo que o pedido tenha sido feito de
// outra sessão.
export async function gerarTokenAlteracaoEmail(usuarioId: string, novoEmail: string) {
  return new SignJWT({ sub: usuarioId, tipo: "alteracao_email", novoEmail })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(DURACAO_TOKEN_ALTERACAO_EMAIL)
    .sign(SEGREDO_ALTERACAO_EMAIL);
}

export async function verificarTokenAlteracaoEmail(token: string) {
  try {
    const { payload } = await jwtVerify<PayloadAlteracaoEmail>(
      token,
      SEGREDO_ALTERACAO_EMAIL,
      { algorithms: ["HS256"] },
    );
    if (payload.tipo !== "alteracao_email") return null;
    return payload;
  } catch (erro) {
    if (erro instanceof errors.JOSEError) return null;
    throw erro;
  }
}

// Token de desafio WebAuthn: carrega o `challenge` gerado pelo
// @simplewebauthn/server entre a etapa de "opções" e a de "confirmar" (o
// browser precisa assinar esse challenge exato) — sem guardar nada em
// sessão/DB pra isso, mesmo padrão stateless do desafio de MFA. O jti é
// consumido via a mesma tabela de uso único do MFA (consumirDesafioMfaJti):
// mesmo sendo um JWT de vida curta (2 min), sem consumo de uso único a
// resposta assinada capturada em trânsito poderia ser reapresentada até o
// token expirar.
export async function gerarTokenDesafioPasskey(challenge: string, usuarioId?: string) {
  const jti = crypto.randomUUID();
  const expiraEm = new Date(Date.now() + DURACAO_TOKEN_DESAFIO_PASSKEY_MS);

  const token = await new SignJWT({ sub: usuarioId, challenge, tipo: "passkey_desafio", jti })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(DURACAO_TOKEN_DESAFIO_PASSKEY)
    .sign(SEGREDO_PASSKEY);

  return { token, jti, expiraEm };
}

export async function verificarTokenDesafioPasskey(token: string) {
  try {
    const { payload } = await jwtVerify<PayloadDesafioPasskey>(token, SEGREDO_PASSKEY, {
      algorithms: ["HS256"],
    });
    if (payload.tipo !== "passkey_desafio") return null;
    return payload;
  } catch (erro) {
    if (erro instanceof errors.JOSEError) return null;
    throw erro;
  }
}
