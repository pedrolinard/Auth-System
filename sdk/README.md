# auth-gateway-sdk

Cliente e verificador de token para aplicações que integram com o Auth Gateway.
Sem dependências além de `jose`, usado só pelo verificador de backend.

- `ClienteAuthGateway`: cadastro, login (com MFA e código de backup), renovação
  automática, logout, usuário atual, conclusão dos links de e-mail. Funciona no
  navegador e no Node.
- `criarVerificadorDeToken`: valida o access token no backend da aplicação
  pelo JWKS público, com emissor, audiência e algoritmo fixos.

Guia completo, com o que cadastrar no painel e a referência das rotas:
[`docs/integracao.md`](../docs/integracao.md).

## Estado

Pacote interno (`"private": true`), consumido direto da fonte (`src/index.ts`).
Os testes em `tests/sdk/sdk.test.ts` exercitam o SDK contra o servidor real. Para
publicar no npm, falta um passo de build (gerar `.js` + `.d.ts`) e definir o
nome público do pacote.
