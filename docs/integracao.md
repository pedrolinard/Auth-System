# Guia de integração

Para quem vai colocar o login deste provedor dentro de uma aplicação.

## 1. Cadastre a aplicação

No painel, em **Aplicações → Nova aplicação** (acesso de quem opera o provedor):

| Campo | O que colocar |
|---|---|
| Nome | Nome que identifica o cliente |
| Origens permitidas | Cada endereço de onde o navegador vai chamar o provedor, só esquema e host: `https://app.cliente.com`. `http` só é aceito para `localhost` |
| RP ID de passkey | O domínio que cobre todas as origens: `cliente.com` |

Ao criar, o painel mostra **uma única vez**:

- **Client ID** (`app_...`): público, vai no código do navegador
- **Client secret** (`sec_...`): segredo, **só no servidor**
- **Audience (aud)**: valor que o backend usa para validar os tokens

### E-mails com a sua marca

Os e-mails enviados aos seus usuários (verificação, redefinição de senha,
alertas de segurança, convites) já saem com o nome da aplicação no assunto e no
cabeçalho. Opcionalmente, no painel:

| Campo | Efeito |
|---|---|
| Remetente | Endereço de envio, ex.: `seguranca@cliente.com`. Precisa ser de um domínio verificado no Resend do provedor, senão o envio falha |
| Endereço dos links | Os links dos e-mails passam a apontar para o seu site, ex.: `https://app.cliente.com/redefinir-senha?token=...` |
| Logo | Imagem https exibida no topo dos e-mails |

Se você configurar o **endereço dos links**, o seu site precisa ter estas
páginas, lendo o `token` da query string e chamando o SDK:

| Página | Método do SDK |
|---|---|
| `/verificar-email` | `auth.verificarEmail(token)` |
| `/redefinir-senha` | `auth.redefinirSenha(token, novaSenha)` |
| `/confirmar-alteracao-email` | `auth.confirmarAlteracaoEmail(token)` |
| `/aceitar-convite` | `auth.aceitarConvite(token)` (com a pessoa logada) |
| `/login` e `/esqueci-senha` | seus próprios formulários |

Sem esse campo, os links vão para as páginas do próprio provedor, que
funcionam para qualquer aplicação.

## 2. Como a aplicação é autenticada

Toda chamada leva o header `x-aplicacao-id: <client ID>`. Além disso:

| De onde vem a chamada | O que o provedor exige |
|---|---|
| Navegador (tem header `Origin`) | A origem precisa estar cadastrada na aplicação |
| Servidor (sem `Origin`) | Header `x-aplicacao-segredo: <client secret>` |

Aplicação sem origens cadastradas não aceita chamadas de navegador. Aplicação
desativada no painel não aceita nada, e as sessões dos usuários dela são
encerradas na hora.

CORS: o provedor responde ao preflight só para origens cadastradas em
aplicações ativas. Cookies do provedor não são usados entre domínios; os tokens
vêm no corpo das respostas.

## 3. No navegador (SDK)

```ts
import { ClienteAuthGateway } from "auth-gateway-sdk";

const auth = new ClienteAuthGateway({
  urlBase: "https://auth.suaempresa.com.br",
  clientId: "app_...",
});

await auth.cadastrar({ nome, email, senha });

const resultado = await auth.entrar({ email, senha });
if (resultado.mfaObrigatorio) {
  await auth.concluirMfa({ mfaToken: resultado.mfaToken, codigo });
  // ou: await auth.concluirMfaComCodigoBackup({ mfaToken, codigo })
}

const usuario = await auth.usuarioAtual();

// Chamada autenticada com renovação automática do token:
const resposta = await auth.requisicao("/api/auth/sessoes");

await auth.sair();
```

Por padrão os tokens ficam só em memória e somem ao recarregar a página. Para
persistir, passe um `armazenamento` próprio, sabendo que qualquer script na
página consegue ler o que estiver em `localStorage`.

Erros chegam como `ErroAuthGateway`, com `status` e `captchaNecessario`. Quando
`captchaNecessario` for `true`, renderize o Cloudflare Turnstile e reenvie com
`turnstileToken`.

## 4. No backend (validar o token)

O backend não chama o provedor a cada requisição. Ele valida o JWT localmente
com as chaves públicas:

```ts
import { criarVerificadorDeToken } from "auth-gateway-sdk";

const verificar = criarVerificadorDeToken({
  urlBase: "https://auth.suaempresa.com.br",
  audiencia: "<Audience (aud) do painel>",
});

const claims = await verificar(tokenDoHeaderAuthorization);
// claims.sub, claims.email, claims.organizacaoId, claims.papelOrganizacao
```

Em outras linguagens, o equivalente é:

- JWKS em `GET /.well-known/jwks.json` (com cache; busque de novo quando
  aparecer um `kid` desconhecido)
- algoritmo fixo `RS256`, nunca o que o token declara
- `iss` = `auth-gateway`
- `aud` = a Audience da aplicação
- `exp` obrigatório. O access token vale 15 minutos.

## 5. Referência rápida das rotas

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| POST | `/api/auth/cadastro` | `nome`, `email`, `senha` | 201, sempre igual (não revela se o e-mail já existia) |
| POST | `/api/auth/login` | `email`, `senha` | `tokenAcesso`, `tokenAtualizacao`, `usuario`, ou `mfaObrigatorio` + `mfaToken` |
| POST | `/api/auth/mfa/verificar` | `mfaToken`, `codigo` (6 dígitos) | tokens |
| POST | `/api/auth/mfa/backup` | `mfaToken`, `codigo` (XXXXX-XXXXX) | tokens + `codigosBackupRestantes` |
| POST | `/api/auth/atualizar` | `tokenAtualizacao` | tokens novos (o anterior deixa de valer) |
| POST | `/api/auth/logout` | `tokenAtualizacao` | `sucesso` |
| POST | `/api/auth/esqueci-senha` | `email` | mensagem genérica |
| GET | `/api/auth/me` | — (Bearer) | `usuario` |
| GET | `/.well-known/jwks.json` | — | chaves públicas |

Cada refresh token vale **uma vez**. Reapresentar um token que já foi trocado é
tratado como roubo: todas as sessões do usuário caem e ele recebe um e-mail de
alerta. Renove de um lugar só (o SDK já faz isso).

Erros: `400` dados inválidos ou aplicação inválida/desativada; `401` sem
sessão ou token inválido; `403` origem não autorizada, CSRF ou conta suspensa;
`429` limite de tentativas.
