import "server-only";

import * as OTPAuth from "otpauth";
import QRCode from "qrcode";

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

export function verificarCodigoMfa(
  segredo: string,
  email: string,
  codigo: string,
): boolean {
  const totp = criarTotp(segredo, email);
  const indiceValidado = totp.validate({ token: codigo, window: JANELA_TOLERANCIA });
  return indiceValidado !== null;
}
