// Verificação do access token no BACKEND da aplicação cliente.
//
// O backend não precisa chamar o provedor a cada requisição: o token é um JWT
// RS256 assinado por uma chave publicada em /.well-known/jwks.json. Basta
// buscar o JWKS (com cache) e conferir assinatura, emissor, audiência e
// validade localmente.

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export const EMISSOR_PROVEDOR = "auth-gateway";

export type ClaimsTokenAcesso = JWTPayload & {
  sub: string;
  email: string;
  aplicacaoId: string;
  organizacaoId: string;
  papelOrganizacao: "dono" | "admin" | "membro";
};

export type OpcoesVerificador = {
  /** URL do provedor, ex.: "https://auth.suaempresa.com.br". */
  urlBase: string;
  /**
   * Valor de `aud` esperado: o campo "Audience (aud)" da aplicação no painel.
   * É o que faz um token emitido para OUTRA aplicação ser recusado aqui.
   */
  audiencia: string;
};

export function criarVerificadorDeToken({ urlBase, audiencia }: OpcoesVerificador) {
  // createRemoteJWKSet já guarda as chaves em cache e busca de novo quando
  // aparece um `kid` desconhecido — é o que torna a rotação de chave
  // transparente para o cliente.
  const jwks = createRemoteJWKSet(new URL("/.well-known/jwks.json", urlBase));

  /** Devolve os claims se o token for válido; lança erro se não for. */
  return async function verificar(token: string): Promise<ClaimsTokenAcesso> {
    const { payload } = await jwtVerify(token, jwks, {
      // Fixo: nunca aceitar o algoritmo que o próprio token declara.
      algorithms: ["RS256"],
      issuer: EMISSOR_PROVEDOR,
      audience: audiencia,
    });
    return payload as ClaimsTokenAcesso;
  };
}
