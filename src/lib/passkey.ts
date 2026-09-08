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

// RP ID precisa ser o domínio exato (sem porta/protocolo) que aparece na
// barra de endereço, e a origem a URL completa — um authenticator recusa a
// cerimônia se qualquer um dos dois não bater com o que o browser reportou.
//
// Os dois deixaram de ser constantes do processo e passaram a vir da
// APLICAÇÃO: uma credencial WebAuthn é presa à origem em que nasceu, então um
// provedor com clientes em domínios próprios não tem como ter um RP ID só.
// Uma origem indevidamente cadastrada numa aplicação é uma passkey aceita
// vinda de um site que não é do cliente — é a lista mais sensível do modelo.
//
// As env vars continuam existindo como fallback pro ambiente de dev e pra
// aplicação padrão que ainda não tenha origens cadastradas.
const RP_ID_PADRAO = process.env.PASSKEY_RP_ID ?? "localhost";
const RP_NAME = process.env.PASSKEY_RP_NAME ?? "Auth Gateway";
const ORIGEM_PADRAO = process.env.PASSKEY_ORIGIN ?? "http://localhost:3000";

// O que o WebAuthn precisa saber sobre a aplicação. Vem de
// resolverAplicacao(), mas fica um tipo local pra este módulo não depender do
// formato completo de Aplicacao.
export type AplicacaoWebAuthn = {
  passkeyRpId: string | null;
  origens: string[];
};

function rpIdDe(aplicacao: AplicacaoWebAuthn | null): string {
  return aplicacao?.passkeyRpId ?? RP_ID_PADRAO;
}

// Todas as origens da aplicação são aceitas (o simplewebauthn aceita array):
// um mesmo cliente pode legitimamente ter mais de uma — apex e www, ou o
// domínio de staging. O que não pode é aceitar QUALQUER origem, que é o que
// aconteceria se a lista vazia virasse "sem checagem".
function origensDe(aplicacao: AplicacaoWebAuthn | null): string[] {
  const origens = aplicacao?.origens ?? [];
  return origens.length > 0 ? origens : [ORIGEM_PADRAO];
}

type CredencialResumo = {
  credentialId: string;
  transportes: string[];
};

// residentKey "required" (não "preferred"): sem uma credencial descobrível
// (resident key) de verdade, o login sem digitar e-mail (allowCredentials
// vazio em gerarOpcoesLoginPasskey) não teria como saber qual credencial
// oferecer — o browser simplesmente não mostraria nada pra escolher.
//
// userVerification "required" (não "preferred"): o login por passkey pula o
// desafio de TOTP mesmo com MFA ativo, então a passkey precisa valer como
// DOIS fatores — posse do authenticator + verificação local (biometria/PIN).
// Com "preferred" o authenticator podia dispensar a verificação e a passkey
// virava fator único. `requireUserVerification: true` nos verify abaixo
// fecha o outro lado: uma resposta sem a flag de UV é recusada.
export async function gerarOpcoesRegistroPasskey(
  usuario: { id: string; email: string; nome: string },
  credenciaisExistentes: CredencialResumo[],
  aplicacao: AplicacaoWebAuthn | null = null,
) {
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpIdDe(aplicacao),
    userName: usuario.email,
    userDisplayName: usuario.nome,
    userID: new TextEncoder().encode(usuario.id),
    attestationType: "none",
    excludeCredentials: credenciaisExistentes.map((credencial) => ({
      id: credencial.credentialId,
      transports: credencial.transportes as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
}

export async function verificarRegistroPasskey(
  response: RegistrationResponseJSON,
  challenge: string,
  aplicacao: AplicacaoWebAuthn | null = null,
) {
  return verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origensDe(aplicacao),
    expectedRPID: rpIdDe(aplicacao),
    requireUserVerification: true,
  });
}

// Sem allowCredentials: login "descobrível" — o browser mostra as passkeys
// já salvas pra este site sem a gente precisar dizer quais IDs existem, o
// que é exatamente o que permite logar sem digitar e-mail antes.
export async function gerarOpcoesLoginPasskey(aplicacao: AplicacaoWebAuthn | null = null) {
  return generateAuthenticationOptions({
    rpID: rpIdDe(aplicacao),
    userVerification: "required",
  });
}

export async function verificarLoginPasskey(
  response: AuthenticationResponseJSON,
  challenge: string,
  credencial: { credentialId: string; publicKey: string; contador: number; transportes: string[] },
  aplicacao: AplicacaoWebAuthn | null = null,
) {
  return verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origensDe(aplicacao),
    expectedRPID: rpIdDe(aplicacao),
    requireUserVerification: true,
    credential: {
      id: credencial.credentialId,
      publicKey: Buffer.from(credencial.publicKey, "base64"),
      counter: credencial.contador,
      transports: credencial.transportes as AuthenticatorTransportFuture[],
    },
  });
}
