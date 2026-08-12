import "server-only";

import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { descriptografar } from "@/lib/cripto";

// Lançado quando o `mfaSecret` armazenado não decifra com nenhuma das chaves
// configuradas (ex.: MFA_ENCRYPTION_KEY rotacionada sem re-cifrar os dados
// existentes, ou MFA_ENCRYPTION_KEY_ANTERIOR configurada errada). Tipo
// próprio pra quem chama distinguir isso de "código errado" (usuário digitou
// o TOTP errado) — o primeiro é um problema do servidor (500, logar e
// investigar), o segundo é do usuário (401, "Código inválido").
export class ErroSegredoMfaIlegivel extends Error {
  constructor() {
    super("Não foi possível decifrar o segredo MFA armazenado.");
    this.name = "ErroSegredoMfaIlegivel";
  }
}

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
//
// Recebe o segredo AINDA CIFRADO (não decifrado pelo chamador) pra
// centralizar aqui o try/catch da decriptação: as quatro rotas que chamam
// esta função (confirmar, verificar, desativar, backup/regenerar) ficam
// livres de duplicar esse tratamento — ver ErroSegredoMfaIlegivel acima.
export async function verificarCodigoMfaSemReplay(
  usuarioId: string,
  segredoCifrado: string,
  email: string,
  codigo: string,
): Promise<boolean> {
  let segredo: string;
  try {
    segredo = descriptografar(segredoCifrado);
  } catch (erroDecifra) {
    console.error(`Falha ao decifrar mfaSecret do usuário ${usuarioId}:`, erroDecifra);
    throw new ErroSegredoMfaIlegivel();
  }

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
