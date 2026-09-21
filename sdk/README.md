# @grupocz/auth-gateway-sdk

Cliente e verificador de token para aplicações que integram com o Auth Gateway.

- `ClienteAuthGateway`: cadastro, login (com MFA e código de backup), renovação
  automática, logout, usuário atual, conclusão dos links de e-mail. Funciona no
  navegador e no Node.
- `criarVerificadorDeToken`: valida o access token no backend da aplicação
  pelo JWKS público, com emissor, audiência e algoritmo fixos.

## Instalação

```bash
npm install @grupocz/auth-gateway-sdk
```

`jose` é peer dependency **opcional**: só o verificador de backend usa. Uma
aplicação de navegador não precisa instalar nada além do SDK.

```bash
# só se você for verificar tokens no seu backend
npm install jose
```

## Uso

**No navegador:** marque a aplicação como **Cliente público** no painel e não
passe `clientSecret`.

```ts
import { ClienteAuthGateway } from "@grupocz/auth-gateway-sdk/cliente";

const auth = new ClienteAuthGateway({
  urlBase: "https://auth.suaempresa.com.br",
  clientId: "seu-client-id",
});
```

**No backend:** passe `clientSecret` e deixe a aplicação confidencial (o
padrão). Aplicação confidencial só renova tokens com o segredo; sem marcar como
pública, a renovação no navegador é recusada e o SDK avisa no console.

```ts
import { criarVerificadorDeToken } from "@grupocz/auth-gateway-sdk/servidor";

const verificar = criarVerificadorDeToken({
  urlBase: "https://auth.suaempresa.com.br",
  audiencia: "aud-da-sua-aplicacao", // painel → Aplicações → Audience (aud)
});

const claims = await verificar(tokenDoHeaderAuthorization);
```

Três pontos de entrada: a raiz (`@grupocz/auth-gateway-sdk`) exporta tudo,
`/cliente` só o cliente (não puxa `jose`) e `/servidor` só o verificador.

Guia completo, com o que cadastrar no painel e a referência das rotas:
[`docs/integracao.md`](../docs/integracao.md).

## Compatibilidade

Pacote **ESM puro** (`"type": "module"`), Node >= 18. Um backend em CommonJS
carrega com `await import("@grupocz/auth-gateway-sdk")`; `require()` não
funciona.

## Build

```bash
npm run build:sdk   # na raiz do repositório: gera sdk/dist (.js + .d.ts)
```

`sdk/dist` fica fora do controle de versão — é gerado no publish, pelo
`prepublishOnly`. Os testes em `tests/sdk/sdk.test.ts` importam `sdk/src`
direto e exercitam o SDK contra o servidor real.

Pra publicar, rode de dentro de `sdk/` (o `prepublishOnly` chama o `tsc` do
`node_modules` daqui, não o da raiz):

```bash
cd sdk
npm install        # só na primeira vez: instala o typescript do próprio pacote
npm publish --access public
```

Confira o que vai no tarball antes com `npm pack --dry-run`.

## Versionamento

Semver **amarrado ao contrato da API do provedor**, não ao ciclo de releases do
provedor:

- **patch** — correção que não muda o contrato (bug no SDK, tipo mais preciso
  pro mesmo dado, mensagem de erro).
- **minor** — capacidade nova que o SDK passa a oferecer porque a API ganhou
  algo: rota, campo na resposta, opção nova cujo padrão preserva o
  comportamento anterior.
- **major** — o que quebra quem já integrou: campo ou método removido ou
  renomeado, mudança no significado de um valor, parâmetro que virou
  obrigatório, ou a versão mínima de Node subindo.

Enquanto a versão for `0.x`, o contrato ainda está em movimento: uma `0.x` nova
pode quebrar. A `1.0.0` é o compromisso de estabilidade — publique-a quando a
API do provedor parar de mudar debaixo dos clientes.

Mudança de contrato no provedor que chegue aqui sai **na mesma publicação** que
a mudança da API e entra no [CHANGELOG.md](./CHANGELOG.md): um SDK que descreve
uma API que já mudou é pior que nenhum SDK.
