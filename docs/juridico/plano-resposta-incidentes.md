# Plano de Resposta a Incidentes de Segurança

> **Rascunho técnico** (ver `LEIA-ANTES.md`). Os prazos legais citados vêm do
> Regulamento de Comunicação de Incidente de Segurança (Resolução CD/ANPD nº
> 15/2024); confirme com o advogado antes de adotar. Os comandos técnicos são
> os deste repositório.

## 1. O que é incidente

Qualquer evento, confirmado ou suspeito, que comprometa a confidencialidade,
integridade ou disponibilidade de dados pessoais. Exemplos neste sistema:

- credencial do banco, chave de assinatura, `MFA_ENCRYPTION_KEY`, segredos JWT
  ou `CRON_SECRET` expostos (repositório, log, máquina de alguém, fornecedor);
- acesso indevido ao banco ou ao painel da Vercel ou do Supabase;
- tokens de sessão vazados em massa;
- dados de uma aplicação cliente visíveis para outra (quebra de isolamento);
- exclusão ou alteração indevida de dados;
- incidente num fornecedor (ver `registro-operacoes-tratamento.md`, seção 4).

## 2. Papéis

| Papel | Quem | Faz |
|---|---|---|
| Responsável pelo incidente | [NOME] | Decide contenção, coordena, registra |
| Encarregado (DPO) | [NOME DO ENCARREGADO] | Avalia risco aos titulares, comunica ANPD e titulares |
| Jurídico | [ADVOGADO] | Revisa comunicações, obrigações contratuais com clientes |

Contato fora do horário: [TELEFONE].

## 3. Onde um incidente aparece

- **Rollbar** (Next.js e Django): erros novos ou picos.
- **Monitor de saúde** (GitHub Actions, a cada 15 min): e-mail quando
  `/api/saude` ou `/api/dominio/saude` falham.
- **Auditoria** (`logs_auditoria`): eventos `reuso_token_detectado`, picos de
  `login_falha`, ações administrativas inesperadas.
- **E-mails de alerta aos titulares**: reuso de token, viagem impossível e
  dispositivo novo. Reclamações de usuários sobre esses alertas são sinal.
- Aviso de fornecedor, de cliente ou de pesquisador.

## 4. Passo a passo

### 4.1 Primeira hora: registrar e conter

1. **Abra o registro** (modelo na seção 6) com data e hora da descoberta. O
   prazo legal conta a partir de quando se tomou conhecimento.
2. **Contenha**, conforme o que vazou:

| O que vazou | Contenção |
|---|---|
| Senha do banco | Supabase → Database → trocar a senha; atualizar `DATABASE_URL` na Vercel nos dois projetos; redeploy dos dois |
| Chave de assinatura dos tokens | `scripts/rotacionar-chave-assinatura.mjs` (gerar → esperar o cache → ativar → remover a antiga). Em emergência, pular a espera derruba sessões, mas corta o atacante |
| `MFA_ENCRYPTION_KEY` | `scripts/rotacionar-chave-mfa.mjs`, seguindo o procedimento do cabeçalho do script |
| Segredos JWT (`JWT_*_SECRET`) | Gerar novos, atualizar na Vercel **antes** do redeploy (sem eles o build falha) |
| Sessões de usuários | Revogar todas as sessões (SQL abaixo). Os access tokens em circulação morrem em até 15 minutos |
| Client secret de uma aplicação | Painel → Aplicações → gerar segredo novo (o antigo deixa de valer na hora) |
| Conta de operador do painel | Suspender a conta; trocar a senha; revisar a auditoria dos últimos 365 dias |
| Acesso à Vercel, Supabase ou GitHub | Revogar tokens e sessões no fornecedor; trocar senha; conferir membros do time |

```sql
-- Revogar todas as sessões ativas (produção, SQL Editor do Supabase)
UPDATE tokens_atualizacao
SET "revogadoEm" = now(), "revogadoMotivo" = 'todas_sessoes_encerradas'
WHERE "revogadoEm" IS NULL AND "expiraEm" > now();
```

3. **Preserve evidências antes de limpar**: exporte os registros relevantes de
   `logs_auditoria`, os logs da Vercel e os itens do Rollbar do período. Não
   apague contas nem registros envolvidos.

### 4.2 Até 24 horas: avaliar

Responda por escrito no registro:

- Quais dados? (ver `registro-operacoes-tratamento.md`, seção 3)
- Quantos titulares e de quais aplicações clientes?
- O dado estava protegido? Hash de senha (bcrypt) e segredo de MFA cifrado
  reduzem o risco; e-mail e IP em claro, não.
- Há dados sensíveis, de crianças, financeiros ou que permitam fraude?
- O atacante ainda tem acesso?

**Pode acarretar risco ou dano relevante aos titulares?** Se sim, a
comunicação é obrigatória (4.3). Se não, registre a justificativa.

### 4.3 Comunicar

| Para quem | Quando | Como |
|---|---|---|
| **ANPD** | Em até **3 dias úteis** do conhecimento, se houver risco ou dano relevante | Formulário de comunicação de incidente no site da ANPD. Informação que ainda faltar pode ser complementada depois, dentro dos prazos do regulamento |
| **Titulares afetados** | Em até **3 dias úteis**, se houver risco ou dano relevante | E-mail individual em linguagem simples: o que aconteceu, quais dados, riscos, o que fizemos, o que a pessoa deve fazer (ex.: trocar a senha em outros sites) |
| **Clientes (controladores)**, quando os titulares forem usuários das aplicações deles | Em até [PRAZO] horas, conforme `acordo-tratamento-dados.md` (cláusula 4.3) | E-mail ao responsável cadastrado da empresa |
| Fornecedor envolvido | Imediatamente | Canal de segurança do fornecedor |

Quando o sistema for **operador**, quem comunica a ANPD e os titulares é o
cliente (controlador); nosso papel é avisá-lo rápido e com os dados da
avaliação.

### 4.4 Depois

1. Corrigir a causa e registrar a correção (commit, deploy, configuração).
2. Revisão em até 15 dias: o que falhou na detecção, na contenção, neste
   plano.
3. Atualizar este plano e `docs/operacao.md`.

## 5. Guarda do registro

Todo incidente, **comunicado ou não**, fica registrado por no mínimo **5
anos**, com a avaliação de risco e as medidas adotadas.

## 6. Modelo de registro

```
Incidente nº:
Descoberto em (data/hora):           Por quem / como:
Ocorrido em (estimativa):
Descrição:
Dados afetados:                      Titulares (quantidade / aplicações):
Papel do sistema (controlador / operador):
Contenção (o que, quando, quem):
Avaliação de risco relevante (sim/não) e justificativa:
Comunicação à ANPD (data, protocolo) ou motivo de não comunicar:
Comunicação aos titulares (data, meio):
Comunicação a clientes (data):
Causa raiz:
Correções:
Revisão pós-incidente (data):
```
