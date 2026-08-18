import "server-only";

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";

// RP_ID precisa ser o domínio exato (sem porta/protocolo) que aparece na
// barra de endereço, e ORIGIN a origem completa — um authenticator recusa a
// cerimônia se qualquer um dos dois não bater com o que o browser reportou
// (ver .env.example). Sem as variáveis configuradas, cai pro dev local.
const RP_ID = process.env.PASSKEY_RP_ID ?? "localhost";
const RP_NAME = process.env.PASSKEY_RP_NAME ?? "Auth Gateway";
const ORIGIN = process.env.PASSKEY_ORIGIN ?? "http://localhost:3000";

type CredencialResumo = {
  credentialId: string;
  transportes: string[];
};

// residentKey "required" (não "preferred"): sem uma credencial descobrível
// (resident key) de verdade, o login sem digitar e-mail (allowCredentials
// vazio em gerarOpcoesLoginPasskey) não teria como saber qual credencial
// oferecer — o browser simplesmente não mostraria nada pra escolher.
export async function gerarOpcoesRegistroPasskey(
  usuario: { id: string; email: string; nome: string },
  credenciaisExistentes: CredencialResumo[],
) {
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: usuario.email,
    userDisplayName: usuario.nome,
    userID: new TextEncoder().encode(usuario.id),
    attestationType: "none",
    excludeCredentials: credenciaisExistentes.map((credencial) => ({
      id: credencial.credentialId,
      transports: credencial.transportes as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
}

export async function verificarRegistroPasskey(
  response: RegistrationResponseJSON,
  challenge: string,
) {
  return verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  });
}

// Sem allowCredentials: login "descobrível" — o browser mostra as passkeys
// já salvas pra este site sem a gente precisar dizer quais IDs existem, o
// que é exatamente o que permite logar sem digitar e-mail antes.
export async function gerarOpcoesLoginPasskey() {
  return generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
  });
}

export async function verificarLoginPasskey(
  response: AuthenticationResponseJSON,
  challenge: string,
  credencial: { credentialId: string; publicKey: string; contador: number; transportes: string[] },
) {
  return verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: credencial.credentialId,
      publicKey: Buffer.from(credencial.publicKey, "base64"),
      counter: credencial.contador,
      transports: credencial.transportes as AuthenticatorTransportFuture[],
    },
  });
}
