# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), versão
[semver](./README.md#versionamento) amarrada ao contrato da API do provedor.

## [Não publicado]

### Adicionado

- Passo de build (`npm run build:sdk`): `sdk/dist` com `.js` + `.d.ts`
  emitidos por `tsc`, sem bundler.
- Pontos de entrada separados: a raiz e `/cliente` dão o cliente (sem `jose`),
  `/servidor` dá o verificador de token. A raiz NÃO reexporta o verificador:
  como `jose` é peer opcional, um `import` da raiz num app de navegador
  quebraria no bundler com "Can't resolve 'jose'".
- `src` vai junto no pacote, pros `.map` do `dist` resolverem.

### Mudado

- Pacote deixou de ser `private` e passou a se chamar
  `@grupocz/auth-gateway-sdk` — antes era `auth-gateway-sdk`, consumido direto
  da fonte dentro do repositório.
- `jose` virou peer dependency **opcional**: quem usa só o cliente no
  navegador não precisa instalar.
- Node mínimo passou a ser 20 (o 18 já saiu do suporte).

## Antes da publicação

O SDK já vinha sendo usado dentro do repositório (`sdk/src`), coberto pelos
testes em `tests/sdk/sdk.test.ts` contra o servidor real. O que ele cobre até
aqui: cadastro, login com MFA e código de backup, renovação automática de
sessão, logout, usuário atual, conclusão dos links de e-mail, verificação do
access token pelo JWKS, cliente público × confidencial e IP do usuário final
na integração pelo servidor.
