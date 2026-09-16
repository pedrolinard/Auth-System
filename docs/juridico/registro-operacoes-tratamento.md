# Registro das Operações de Tratamento de Dados Pessoais

> **Rascunho técnico** (ver `LEIA-ANTES.md`). Exigido pelo art. 37 da LGPD.
> Escrito a partir do código e da infraestrutura em 2026-09-16. Atualize a cada
> dado novo, fornecedor novo ou mudança de retenção. Agente de pequeno porte
> pode usar o modelo simplificado da ANPD (Resolução CD/ANPD nº 2/2022):
> confirme o enquadramento com o advogado.

## 1. Identificação

| Campo | Valor |
|---|---|
| Agente | [RAZÃO SOCIAL], [CNPJ], [ENDEREÇO] |
| Encarregado | [NOME DO ENCARREGADO], [E-MAIL DO ENCARREGADO] |
| Serviço | Provedor de autenticação (Next.js) e serviço de domínio de projetos e tarefas (Django) |
| Última revisão | 2026-09-16 |

## 2. Papel em cada tratamento

O mesmo sistema trata dados em dois papéis diferentes:

| Contexto | Papel | Titulares |
|---|---|---|
| Painel do serviço (aplicação padrão) e contas das empresas clientes | **Controlador** | Pessoas que usam o painel; responsáveis pelas empresas clientes |
| Contas de usuários finais das aplicações dos clientes | **Operador** (o cliente é o controlador; ver `acordo-tratamento-dados.md`) | Usuários finais de cada aplicação cliente |

## 3. Operações

Colunas: **dado** e onde ele está · **finalidade** · **base legal sugerida**
(art. 7º; a definitiva é do advogado, e no papel de operador ela é do cliente) ·
**retenção** e como ela é aplicada.

### 3.1 Conta

| Dado (tabela) | Finalidade | Base legal sugerida | Retenção |
|---|---|---|---|
| Nome, e-mail, data de criação (`usuarios`) | Identificar a conta, comunicar avisos de segurança | Execução de contrato (V) | Enquanto a conta existir; apagado na exclusão |
| Hash da senha (bcrypt, `usuarios`) | Autenticar | Execução de contrato (V) | Idem |
| Segredo de MFA cifrado, último passo usado (`usuarios`), hashes dos códigos de backup (`codigos_backup_mfa`) | Segundo fator | Execução de contrato (V) | Até o titular desativar ou excluir a conta |
| Chave pública e nome das passkeys (`passkeys`) | Login sem senha | Execução de contrato (V) | Até o titular remover ou excluir a conta |
| Organizações, papéis, suspensão e motivo (`organizacoes`, `membros`) | Controle de acesso dentro da aplicação | Execução de contrato (V) | Enquanto a conta existir |
| E-mail convidado e autor do convite (`convites_organizacao`) | Convidar alguém para uma organização | Legítimo interesse (IX) de quem convida | Aceito: apagado na limpeza diária seguinte. Pendente: 30 dias sem reenvio (o link vence em 7) |

### 3.2 Sessão e segurança

| Dado (tabela) | Finalidade | Base legal sugerida | Retenção |
|---|---|---|---|
| IP, navegador, cidade/região/país aproximados de cada sessão (`tokens_atualizacao`) | Lista de sessões ativas, alerta de dispositivo novo e de "viagem impossível" | Legítimo interesse (IX) / prevenção à fraude (art. 11, II, "g", por analogia) | Até 30 dias de vida; apagado na limpeza diária após expirar, ou 7 dias após revogado |
| Dispositivo confiável: só hash do token (`dispositivos_confiaveis`) | Pular o MFA num dispositivo marcado pelo titular | Execução de contrato (V) | Até expirar; limpeza diária |
| Trilha de auditoria: evento, data, IP, navegador, e-mail do alvo e do autor (`logs_auditoria`) | Investigar incidentes e abuso; prova de ações administrativas | Legítimo interesse (IX); exercício regular de direitos (VI) | 365 dias (limpeza diária). **Na exclusão da conta, e-mail, IP e navegador são apagados na hora** (`src/lib/anonimizacao.ts`) |
| Contadores de tentativas com IP ou e-mail na chave (`limites_taxa`) | Limite de tentativas contra força bruta | Legítimo interesse (IX) | Janela de 5 min a 2 h; apagado na limpeza diária seguinte |
| Códigos de autorização OIDC: só hash (`codigos_autorizacao`) | Login hospedado | Execução de contrato (V) | 60 s de validade + 1 dia |

### 3.3 Integração com as aplicações clientes

| Dado (tabela) | Finalidade | Base legal | Retenção |
|---|---|---|---|
| Id e e-mail do usuário em eventos enviados ao sistema do cliente (`entregas_webhook.payload`) | Avisar o cliente do que aconteceu com as contas dele | Do controlador (cliente) | 30 dias (limpeza diária); apagadas na exclusão da conta |
| Pedido de exclusão pendente no Django: só ids (`exclusoes_dominio_pendentes`) | Garantir que a exclusão chegue ao serviço de domínio | Cumprimento do direito de eliminação (art. 18, VI) | Até o Django confirmar |

### 3.4 Serviço de domínio (Django, schema `dominio`)

| Dado | Finalidade | Base legal | Retenção |
|---|---|---|---|
| Nome e descrição de projetos; título, descrição, status e prazo de tarefas; id do usuário e da organização | Funcionalidade do produto | Execução de contrato (V) | Enquanto a organização existir; apagados na exclusão da conta ou da organização |

Texto livre (descrições) pode conter qualquer dado que o usuário digitar,
inclusive de terceiros. O serviço não inspeciona esse conteúdo.

### 3.5 O que o sistema **não** trata

- Dados sensíveis (art. 11) de forma intencional.
- Dados de crianças e adolescentes de forma intencional (não há verificação de idade: [DECIDIR se os termos proíbem menores]).
- Cookies de publicidade, rastreamento ou perfilamento. Só cookies essenciais: sessão, renovação e CSRF.

## 4. Compartilhamento e transferência internacional

| Fornecedor | Função | Dados | Onde | Confirmado em |
|---|---|---|---|---|
| Vercel Inc. | Execução das funções e CDN | Todos, em trânsito | EUA: funções em `iad1` (Virgínia); borda mais próxima do usuário (`gru1`, São Paulo) | Header `x-vercel-id` de produção |
| Supabase Inc. | Banco de dados | Todos, em repouso | EUA: `us-east-1` | Host do pooler de produção |
| Resend | Envio de e-mail | E-mail e conteúdo das mensagens | EUA | [CONFIRMAR no contrato] |
| Cloudflare (Turnstile) | Proteção contra robôs | IP e sinais do navegador | Rede global | [CONFIRMAR no contrato] |
| Rollbar | Monitoramento de erros | Dados técnicos do erro, caminho da página (sem query string), IP truncado (último octeto zerado) | EUA | [CONFIRMAR no contrato] |
| Have I Been Pwned | Checar senha vazada | 5 primeiros caracteres do hash SHA-1 da senha (não identifica ninguém) | Cloudflare / Austrália | Código (`src/lib/senhaVazada.ts`) |

**Há transferência internacional** (art. 33). Mecanismo: [DEFINIR com o
advogado. O caminho usual é incorporar as cláusulas-padrão contratuais da
Resolução CD/ANPD nº 19/2024 nos contratos com os fornecedores ou verificar se
os termos deles já as oferecem].

## 5. Pontos em aberto

1. **Base legal definitiva** de cada linha e o documento de legítimo interesse
   (LIA) para as linhas marcadas com IX.
2. **Transferência internacional** (seção 4).

## 6. Medidas de segurança

Ver o Anexo I de `acordo-tratamento-dados.md` e `docs/operacao.md`.
