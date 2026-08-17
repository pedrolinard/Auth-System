import "server-only";

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/token";

export const DURACAO_DISPOSITIVO_CONFIAVEL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

// Emitido só quando o usuário marca "lembrar este dispositivo" ao concluir o
// desafio de MFA. Reaproveita hashToken (mesmo esquema do token de
// atualização): o valor puro vira cookie no navegador, só o hash SHA-256
// fica no banco.
export async function criarDispositivoConfiavel(usuarioId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiraEm = new Date(Date.now() + DURACAO_DISPOSITIVO_CONFIAVEL_MS);

  await prisma.dispositivoConfiavel.create({
    data: { usuarioId, tokenHash: hashToken(token), expiraEm },
  });

  return { token, expiraEm };
}

export async function dispositivoEhConfiavel(
  usuarioId: string,
  token: string | undefined,
): Promise<boolean> {
  if (!token) return false;

  const registro = await prisma.dispositivoConfiavel.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  return !!registro && registro.usuarioId === usuarioId && registro.expiraEm > new Date();
}

// Chamado nos mesmos pontos que já derrubam todas as sessões ativas
// (redefinição de senha, troca de senha logado) — uma senha comprometida
// não pode deixar um "dispositivo confiável" antigo como atalho pra pular o
// MFA depois da recuperação.
export async function revogarDispositivosConfiaveis(usuarioId: string) {
  await prisma.dispositivoConfiavel.deleteMany({ where: { usuarioId } });
}
