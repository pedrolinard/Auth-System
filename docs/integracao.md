# Guia de integração

Para quem vai colocar o login deste provedor dentro de uma aplicação.

## 1. Cadastre a aplicação

No painel, em **Aplicações → Nova aplicação**. Quem pode:

- **Você mesmo (self-service):** crie uma conta no painel, verifique o e-mail e,
  como dono ou admin da sua organização, cadastre até 3 aplicações. Você só
  enxerga e edita as aplicações da sua organização.
- **Quem opera o provedor:** vê e gerencia todas, e é o único que define um
  remetente de e-mail próprio (ele sai do domínio verificado do provedor).

Campos:

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
| Remetente | Endereço de envio, ex.: `seguranca@cliente.com`. Precisa ser de um domínio verificado no Resend do provedor, senão o envio falha. Só quem opera o provedor define |
| Endereço dos links | Os links dos e-mails passam a apontar para o seu site, ex.: `https://app.cliente.com/redefinir-senha?token=...` |
| Logo | Imagem https exibida no topo dos e-mails |

### Checklist de quem opera o provedor

- [ ] Origens e RP ID conferidos com o cliente
- [ ] Client secret entregue por canal seguro (ele não aparece de novo)
- [ ] Domínio do cliente adicionado ao widget do Turnstile na Cloudflare (seção 3)
- [ ] Remetente próprio, se houver: domínio verificado no Resend

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
| Servidor | Header `x-aplicacao-segredo: <client secret>`. Se o header vier, ele decide: segredo errado é `401` mesmo com uma origem cadastrada |
| Navegador (header `Origin`, sem segredo) | A origem precisa estar cadastrada na aplicação |

Aplicação sem origens cadastradas não aceita chamadas de navegador. Aplicação
desativada no painel não aceita nada, e as sessões dos usuários dela são
encerradas na hora.

**O que a origem protege, e o que não protege.** O navegador não deixa uma
página mentir a própria origem, então a lista de origens impede que um site
qualquer monte um login em nome da sua aplicação. Fora do navegador, o header
`Origin` é só texto: um script consegue enviar a origem que quiser e chamar as
rotas públicas (login, cadastro, esqueci a senha) sem o client secret, como
faria qualquer navegador. Contra automação, as barreiras são os limites de
tentativas (por IP e por conta) e o Turnstile, não o client secret. O secret
autentica o **seu backend**; ele não impede que alguém use as mesmas rotas
públicas que o seu site usa.

### IP do usuário final (integração pelo servidor)

Quando o seu backend chama o provedor em nome dos usuários, todos chegam com o
IP do seu servidor. Sem mais nada, poucas senhas erradas somadas bloqueiam o
login ou pedem captcha para **todos** os seus usuários. Envie o IP de quem está
usando o seu site:

```
x-aplicacao-segredo: <client secret>
x-usuario-ip: 203.0.113.10
```

O header só é aceito junto de um client secret que confere, e vale no login, no
cadastro, no esqueci a senha, no login por passkey, na renovação e na conclusão
do MFA. Sem o secret, ele é ignorado. No SDK: `ipUsuarioFinal` nas opções, com
um cliente por requisição do usuário.

As tentativas de código de MFA também são limitadas por conta (10 falhas em 15
minutos), qualquer que seja o IP.

CORS: o provedor responde ao preflight só para origens cadastradas em
aplicações ativas. Cookies do provedor não são usados entre domínios; os tokens
vêm no corpo das respostas.

## 3. Login hospedado (OpenID Connect) — o caminho recomendado

Em vez de montar formulários de login no seu site, mande o usuário para a tela
do provedor. Ele entra lá (com MFA, captcha e todas as proteções) e volta para
o seu site com um código, que o seu backend troca por tokens. Seu site nunca
vê a senha. Funciona com qualquer biblioteca OpenID Connect (next-auth /
Auth.js, openid-client, Spring Security, ASP.NET, Passport).

**Pré-requisitos no painel:** aplicação **aprovada** por quem opera o provedor
e a URL de retorno cadastrada em "URLs de retorno (login hospedado)".

| Configuração da biblioteca | Valor |
|---|---|
| Issuer / Discovery | `https://auth.suaempresa.com.br` (`/.well-known/openid-configuration`) |
| Client ID | o `app_...` do painel |
| Client secret | o `sec_...` no backend. SPA ou app sem backend: marque **Cliente público** no painel e não use o secret |
| Redirect URI | exatamente uma das URLs cadastradas |
| Scopes | `openid email profile` (+ `offline_access` para receber refresh token) |
| PKCE | obrigatório, `S256` |

Regras que o provedor aplica e você não precisa reimplementar:

- `redirect_uri` comparado por igualdade exata com o cadastro (sem prefixo).
- Código de autorização de uso único, válido por 60 segundos. Reapresentado
  depois de trocado, derruba a sessão emitida com ele.
- `id_token` RS256 com `iss` = issuer, `aud` = client ID e `nonce` ecoado.
  Valide com o JWKS do discovery.
- A resposta de retorno traz `iss` (RFC 9207): confira se é o issuer esperado.
- Sem sessão única (SSO) por enquanto: cada login passa pela tela.
- **Cliente confidencial** (padrão, tem backend): o client secret é exigido pra
  trocar o código, pro `refresh_token` e pra renovar em `/api/auth/atualizar`
  com o token no corpo (header `x-aplicacao-segredo`). Um refresh token vazado
  não é resgatado só com o client ID. **Cliente público**: sem segredo, com
  PKCE.
- O `refresh_token` devolve `access_token` e um `refresh_token` novo (o
  anterior deixa de valer), sem `id_token` nem `scope`. O escopo autorizado no
  login continua valendo no access token renovado e no userinfo.

Endpoints: `GET /autorizar`, `POST /api/oidc/token` (`authorization_code` e
`refresh_token`), `GET /api/oidc/userinfo`.

## 3.1. Formulários próprios (SDK)

> **SDK no navegador exige marcar "Cliente público" no painel.** Aplicação
> confidencial (o padrão) só renova tokens com o client secret, que não pode
> ir pro navegador. Sem marcar, a primeira renovação é recusada (401,
> `clienteConfidencial: true`) e o SDK avisa no console. No backend, use o SDK
> com `clientSecret` e deixe a aplicação confidencial.

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
página consegue ler o que estiver em `localStorage`. Com várias abas dividindo
o mesmo armazenamento, o SDK serializa as renovações entre elas (Web Locks) e
relê o armazenamento antes de renovar, então uma aba não desloga a outra.

Erros chegam como `ErroAuthGateway`, com `status`, `captchaNecessario` e
`turnstileSiteKey`. Quando `captchaNecessario` for `true`:

1. Renderize o [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/)
   com a sitekey de `erro.turnstileSiteKey` (é a sitekey pública do provedor).
2. Reenvie a mesma chamada com o `turnstileToken` que o widget devolver.

O widget só renderiza em domínios liberados nessa sitekey. **Ao cadastrar uma
aplicação**, quem opera o provedor precisa adicionar o domínio do cliente em
Cloudflare → Turnstile → (widget do provedor) → Hostname Management. Sem isso,
o usuário do cliente fica sem como passar do captcha.

## 4. Webhooks

No painel, em cada aplicação → **Webhooks**, cadastre uma URL https (porta
padrão) e escolha os eventos. O provedor avisa o seu sistema quando algo
acontece com as contas da sua aplicação. Só aplicações **aprovadas** recebem.

| Evento | Quando | `dados` |
|---|---|---|
| `usuario.criado` | cadastro | `usuario.id`, `usuario.email` |
| `usuario.email_verificado` | primeiro clique no link de verificação | `usuario` |
| `usuario.email_alterado` | troca de e-mail confirmada | `usuario` (e-mail novo), `emailAnterior` |
| `usuario.senha_alterada` | troca ou redefinição de senha | `usuario` |
| `usuario.mfa_ativado` / `usuario.mfa_desativado` | verificação em duas etapas | `usuario` |
| `usuario.excluido` | a pessoa excluiu a conta | `usuario.id` |
| `membro.suspenso` / `membro.reativado` | suspensão numa organização | `usuario`, `organizacaoId`, `suspensoAte` |

Cada entrega é um `POST` JSON: `{ "id", "evento", "criadoEm", "dados" }`. O
`id` é o mesmo em todas as tentativas da entrega: use-o pra ignorar
duplicatas. Responda `2xx` rápido (em até 10 s); qualquer outra coisa conta
como falha e o provedor tenta de novo em 1 min, 5 min, 30 min, 2 h e 12 h.
Cinco entregas seguidas sem sucesso desligam o webhook (religue no painel).

**Confira a assinatura em toda entrega** (o segredo `whsec_...` aparece uma vez
ao criar ou rotacionar):

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function assinaturaValida(corpoCru: string, cabecalho: string, segredo: string) {
  const [, t, v1] = /^t=(\d+),v1=([0-9a-f]+)$/.exec(cabecalho) ?? [];
  if (!t || !v1) return false;
  // Recuse entregas velhas: impede reenviar uma entrega capturada.
  if (Math.abs(Date.now() / 1000 - Number(t)) > 5 * 60) return false;
  const esperado = createHmac("sha256", segredo).update(`${t}.${corpoCru}`).digest("hex");
  return esperado.length === v1.length && timingSafeEqual(Buffer.from(esperado), Buffer.from(v1));
}
// header: x-auth-gateway-assinatura. Use o corpo CRU, antes de fazer JSON.parse.
```

## 5. No backend (validar o token)

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

Cada refresh token vale **uma vez**. Reapresentar um token que já foi trocado
**há mais de 30 segundos** é tratado como roubo: todas as sessões do usuário
caem e ele recebe um e-mail de alerta. Dentro dos 30 segundos, a reapresentação
é só recusada (`401`), para cobrir a retentativa de uma resposta que se perdeu
na rede. Renove de um lugar só (o SDK já faz isso).

Erros: `400` dados inválidos ou aplicação inválida/desativada; `401` sem
sessão ou token inválido; `403` origem não autorizada, CSRF ou conta suspensa;
`429` limite de tentativas.
