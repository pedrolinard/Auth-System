# Documentos jurídicos — rascunhos

**Nada nesta pasta é documento final.** São rascunhos técnicos, escritos a partir
do que o sistema realmente faz (dados que guarda, por quanto tempo, com quem
compartilha), para servir de ponto de partida a um advogado. Não assine, não
publique e não envie a um cliente sem essa revisão.

| Arquivo | Para quem | O que cobre |
|---|---|---|
| `termos-de-uso.md` | Empresas que contratam o provedor | Objeto do serviço, responsabilidades, disponibilidade, suspensão, rescisão |
| `politica-de-privacidade.md` | Usuários finais das aplicações clientes | Quais dados são tratados, finalidade, retenção, direitos do titular (LGPD) |
| `acordo-tratamento-dados.md` | Empresas que contratam (anexo ao contrato) | Papéis de controlador e operador, suboperadores, incidentes, eliminação |
| `registro-operacoes-tratamento.md` | Uso interno; ANPD, se pedir (art. 37) | Cada dado pessoal: onde fica, finalidade, base legal sugerida, retenção, fornecedores e transferência internacional |
| `plano-resposta-incidentes.md` | Uso interno | Detecção, contenção com os comandos deste sistema, avaliação de risco, prazos de comunicação à ANPD e aos titulares, modelo de registro |

## Campos a preencher

Todos os documentos usam marcadores entre colchetes que precisam ser trocados:

- `[RAZÃO SOCIAL]`, `[CNPJ]`, `[ENDEREÇO]`: dados da empresa que vende o serviço
- `[E-MAIL DO ENCARREGADO]`: contato do encarregado de dados (DPO), exigido pela LGPD
- `[NOME]`, `[TELEFONE]`, `[ADVOGADO]`: responsáveis no plano de incidentes
- `[FORO]`: comarca para disputas
- `[PRAZO DE SLA]` e `[PERCENTUAL]`: só depois de definir a infraestrutura paga (ver `docs/operacao.md`)

## Pontos que dependem de decisão de negócio, não de redação

1. **Quem detém os direitos do código.** Se o sistema foi desenvolvido em horário
   ou com recursos de um empregador, isso precisa estar resolvido antes de
   vender.
2. **Onde os dados ficam.** Hoje o banco está na Supabase e as funções na
   Vercel. A região de cada um define se há transferência internacional
   (art. 33 da LGPD). Confirme as regiões nos painéis antes de escrever a
   cláusula.
3. **Qual disponibilidade prometer.** Não prometa SLA com a infraestrutura
   gratuita atual.
