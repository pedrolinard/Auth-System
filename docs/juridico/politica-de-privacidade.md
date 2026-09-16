# Política de Privacidade

> **RASCUNHO — revisar com advogado antes de publicar.** Ver `LEIA-ANTES.md`.
> Esta política cobre o serviço de autenticação. Cada empresa cliente continua
> responsável por informar aos seus usuários como ela própria usa os dados.

Última atualização: [DATA]

## Quem somos

O serviço de login da aplicação que você está usando é operado por
[RAZÃO SOCIAL], CNPJ [CNPJ], em nome da empresa dona dessa aplicação.
A empresa dona da aplicação é a **controladora** dos seus dados. Nós somos
**operadores**: tratamos os dados só para fazer o login funcionar com segurança.

Encarregado de dados: [E-MAIL DO ENCARREGADO]

## Quais dados tratamos e por quê

- **Nome e e-mail**: para identificar sua conta e enviar avisos de segurança,
  como login em dispositivo novo, troca de senha e redefinição de senha.
- **Senha**: guardamos só uma versão irreversível (hash). Ninguém da equipe
  consegue ver sua senha.
- **Verificação em duas etapas e passkeys**: o segredo do autenticador fica
  cifrado; da passkey guardamos só a chave pública.
- **Dados de acesso**: endereço IP, tipo de navegador e localização aproximada
  (cidade, estado e país) de cada sessão, para mostrar suas sessões ativas e
  detectar acessos suspeitos.
- **Registro de segurança**: eventos como login, falha de login e troca de
  senha, para investigar incidentes.

Não usamos seus dados para publicidade e não os vendemos.

## Por quanto tempo

- Conta e dados de perfil: enquanto a conta existir.
- Sessões: duram no máximo 30 dias e são apagadas logo depois de expirar, ou
  7 dias depois de encerradas.
- Registro de segurança: 365 dias. Se você excluir a conta, os registros
  continuam existindo só como eventos e datas: e-mail, endereço IP e
  navegador são apagados na hora.
- Avisos enviados ao sistema da empresa dona da aplicação (webhooks): 30
  dias, e os que têm o seu e-mail são apagados quando você exclui a conta.

## Com quem compartilhamos

Com os fornecedores necessários para o serviço funcionar: hospedagem (Vercel),
banco de dados (Supabase), envio de e-mail (Resend), proteção contra robôs
(Cloudflare) e monitoramento de erros (Rollbar). Para checar se sua senha
apareceu em vazamentos, enviamos ao serviço Have I Been Pwned **apenas um
fragmento de um código derivado da senha**, que não permite descobri-la.

[CONFIRMAR se algum desses fornecedores armazena dados fora do Brasil e incluir
a informação exigida pelo art. 33 da LGPD.]

## Seus direitos

Você pode, a qualquer momento:

- **Baixar uma cópia dos seus dados**, na tela de conta, confirmando sua senha.
- **Excluir sua conta**, na mesma tela. A exclusão é permanente.
- Corrigir nome e e-mail.
- Ver e encerrar suas sessões ativas.

Para outros pedidos, fale com a empresa dona da aplicação ou com o nosso
encarregado em [E-MAIL DO ENCARREGADO].

## Segurança

Usamos cifragem, verificação em duas etapas, limites de tentativas, detecção de
uso indevido de sessão e registro de eventos de segurança. Nenhum sistema é
invulnerável; se houver um incidente que coloque seus dados em risco, a empresa
dona da aplicação e, quando exigido, a ANPD serão comunicadas.
