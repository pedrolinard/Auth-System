import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

// Torna o desafio de MFA (mfaToken) de uso único: mesmo sendo um JWT
// stateless válido por até 5 min, uma tentativa bem-sucedida (TOTP válido em
// /mfa/verificar OU código de backup válido em /mfa/backup) consome o jti —
// uma segunda tentativa com o mesmo mfaToken, ainda dentro da validade, não
// completa outro login. Insert com jti como chave única: a segunda tentativa
// esbarra na constraint (P2002) e é tratada como já consumido, sem precisar
// de um SELECT-then-INSERT sujeito a corrida.
export async function consumirDesafioMfaJti(jti: string, expiraEm: Date): Promise<boolean> {
  try {
    await prisma.desafioMfaConsumido.create({ data: { jti, expiraEm } });
    return true;
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      return false;
    }
    throw erro;
  }
}
