import "server-only";

import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";

const EMISSOR = "Auth Gateway";
const JANELA_TOLERANCIA = 1; // aceita o código do passo anterior/seguinte (±30s)

function criarTotp(segredo: string, email: string) {
  return new OTPAuth.TOTP({
    issuer: EMISSOR,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(segredo),
  });
}

export function gerarSegredoMfa() {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export async function gerarQrCodeMfa(segredo: string, email: string) {
  const totp = criarTotp(segredo, email);
  const otpauthUrl = totp.toString();
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
  return { otpauthUrl, qrCodeDataUrl };
}

// Retorna o timestep (contador de janelas de 30s desde a época) que o
// código validou, ou null se inválido. Não decide sozinho sobre reuso — só
// diz QUAL timestep bateu; verificarCodigoMfaSemReplay (abaixo) é quem
// compara com o último aceito.
function verificarCodigoMfa(segredo: string, email: string, codigo: string): number | null {
  const totp = criarTotp(segredo, email);
  const delta = totp.validate({ token: codigo, window: JANELA_TOLERANCIA });
  if (delta === null) return null;
  return totp.counter({}) + delta;
}

// Verifica o código TOTP E impede reusá-lo: um código válido "gasto" numa
// chamada não pode validar de novo em outra dentro dos mesmos ±30s (janela
// de tolerância). O UPDATE condicionado a `mfaUltimoTimestep < novoTimestep`
// (ou nulo) vira uma única instrução atômica no Postgres — duas requisições
// concorrentes com o MESMO código só deixam uma "vencer" o update, a outra
// reavalia a condição já sem bater (mesmo princípio do consumo de código de
// backup em backupMfa.ts).
export async function verificarCodigoMfaSemReplay(
  usuarioId: string,
  segredo: string,
  email: string,
  codigo: string,
): Promise<boolean> {
  const timestepValidado = verificarCodigoMfa(segredo, email, codigo);
  if (timestepValidado === null) return false;

  const { count } = await prisma.usuario.updateMany({
    where: {
      id: usuarioId,
      OR: [{ mfaUltimoTimestep: null }, { mfaUltimoTimestep: { lt: timestepValidado } }],
    },
    data: { mfaUltimoTimestep: timestepValidado },
  });

  return count === 1;
}
