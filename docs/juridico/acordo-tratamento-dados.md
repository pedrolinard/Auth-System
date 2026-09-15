# Acordo de Tratamento de Dados Pessoais

> **RASCUNHO — revisar com advogado antes de usar.** Ver `LEIA-ANTES.md`.

Anexo ao contrato de prestação de serviços entre:

- **CONTROLADORA:** a empresa cliente identificada no contrato principal, que
  decide sobre o tratamento dos dados dos seus usuários finais; e
- **OPERADORA:** [RAZÃO SOCIAL], inscrita no CNPJ sob o nº [CNPJ], com sede em
  [ENDEREÇO], que presta o serviço de autenticação em nome da CONTROLADORA.

## 1. Objeto

1.1. Este acordo regula o tratamento de dados pessoais que a OPERADORA realiza
por conta da CONTROLADORA ao prestar o serviço de autenticação (cadastro,
login, verificação em duas etapas, passkeys, gestão de sessões e
organizações), nos termos da Lei nº 13.709/2018 (LGPD).

## 2. Papéis

2.1. A CONTROLADORA define as finalidades do tratamento e é responsável pela
base legal perante os seus usuários finais.

2.2. A OPERADORA trata os dados apenas conforme as instruções da CONTROLADORA,
registradas neste acordo e na configuração da aplicação no painel do serviço.

## 3. Dados tratados

3.1. Categorias de titulares: usuários finais das aplicações da CONTROLADORA.

3.2. Dados tratados pelo serviço:

| Dado | Finalidade | Retenção |
|---|---|---|
| Nome e e-mail | Identificação e comunicação de segurança | Enquanto a conta existir |
| Senha | Autenticação (guardada só como hash bcrypt, nunca em texto) | Enquanto a conta existir |
| Segredo de verificação em duas etapas | Segundo fator (cifrado com AES-256-GCM) | Até o titular desativar |
| Chave pública de passkey | Login sem senha (a chave privada nunca sai do dispositivo) | Até o titular remover |
| Sessões: IP, navegador, cidade/região/país aproximados | Segurança da conta e lista de sessões ativas | Vida máxima de 30 dias; removida na limpeza seguinte à expiração, ou 7 dias após revogada |
| Trilha de auditoria: evento, IP, navegador, data | Investigação de incidentes e prova de ações administrativas | 365 dias |
| Organizações, papéis e suspensões | Controle de acesso dentro da aplicação | Enquanto a conta existir |

3.3. A OPERADORA **não** trata dados sensíveis (art. 11 da LGPD) e não usa os
dados para finalidade própria, publicidade ou perfilamento.

## 4. Obrigações da OPERADORA

4.1. Manter as medidas de segurança descritas no Anexo I.

4.2. Garantir que os dados de uma CONTROLADORA fiquem isolados dos de outras
clientes (identidade, sessões, organizações, passkeys e auditoria separadas por
aplicação).

4.3. Comunicar à CONTROLADORA qualquer incidente de segurança que possa
acarretar risco ou dano relevante aos titulares em até [PRAZO] horas após tomar
conhecimento, com a natureza dos dados afetados, os titulares envolvidos e as
medidas adotadas.

4.4. Apoiar a CONTROLADORA no atendimento aos direitos dos titulares. O
serviço já oferece ao próprio titular a exportação e a exclusão da conta.

4.5. Manter registro das operações de tratamento (art. 37 da LGPD).

## 5. Suboperadores

5.1. A CONTROLADORA autoriza os suboperadores abaixo, necessários à prestação
do serviço:

| Suboperador | Função | Dados envolvidos |
|---|---|---|
| Vercel Inc. | Hospedagem das funções | Todos, em trânsito |
| Supabase Inc. | Banco de dados | Todos, em repouso |
| Resend | Envio de e-mail | E-mail e conteúdo das mensagens de segurança |
| Cloudflare (Turnstile) | Proteção contra automação | IP e sinais do navegador |
| Have I Been Pwned | Checagem de senha vazada | Apenas os 5 primeiros caracteres do hash SHA-1 da senha |
| Rollbar | Monitoramento de erros | Dados técnicos do erro |

5.2. A inclusão de novo suboperador será comunicada com [PRAZO] dias de
antecedência.

5.3. [CONFIRMAR as regiões de hospedagem e redigir a cláusula de transferência
internacional, se houver — art. 33 da LGPD.]

## 6. Término

6.1. Encerrado o contrato, a OPERADORA eliminará os dados da CONTROLADORA em até
[PRAZO] dias, salvo obrigação legal de guarda, e fornecerá, a pedido, exportação
dos dados em formato estruturado antes da eliminação.

## Anexo I — Medidas de segurança

- Senhas com bcrypt (12 rodadas); recusa de senhas presentes em vazamentos conhecidos
- Segredos de segundo fator cifrados em repouso com AES-256-GCM
- Tokens de acesso RS256 de 15 minutos, com chaves rotacionáveis publicadas em JWKS
- Refresh token rotacionado a cada uso, com detecção de reuso
- Cookies httpOnly, proteção CSRF e Content-Security-Policy com nonce por requisição
- Limite de tentativas por IP e por conta, e CAPTCHA progressivo
- Verificação em duas etapas, códigos de backup e passkeys
- Trilha de auditoria de ações de segurança e administrativas
- Isolamento lógico entre aplicações clientes
- Testes automatizados de segurança executados a cada alteração do código
