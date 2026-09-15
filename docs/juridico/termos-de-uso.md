# Termos de Uso do Serviço

> **RASCUNHO — revisar com advogado antes de usar.** Ver `LEIA-ANTES.md`.

Última atualização: [DATA]

Estes termos regulam a contratação do serviço de autenticação oferecido por
[RAZÃO SOCIAL], CNPJ [CNPJ] ("Provedor"), pela empresa que cadastra uma
aplicação no painel ("Cliente").

## 1. O serviço

1.1. O Provedor oferece, para as aplicações do Cliente: cadastro e login de
usuários finais, verificação em duas etapas, passkeys, gestão de sessões,
organizações com papéis, trilha de auditoria e emissão de tokens de acesso
verificáveis por chaves públicas (JWKS).

1.2. Cada aplicação do Cliente recebe um identificador público (client ID) e um
segredo (client secret). O segredo é mostrado uma única vez; guardá-lo é
responsabilidade do Cliente.

## 2. Responsabilidades do Cliente

2.1. Manter o client secret em sigilo e rotacioná-lo pelo painel em caso de
suspeita de vazamento.

2.2. Cadastrar corretamente as origens e o domínio de passkey das suas
aplicações.

2.3. Informar aos seus usuários finais a finalidade do tratamento dos dados e a
base legal (o Cliente é o controlador — ver Acordo de Tratamento de Dados).

2.4. Não usar o serviço para atividade ilícita, envio de spam ou tentativa de
acesso a dados de outros clientes.

## 3. Responsabilidades do Provedor

3.1. Manter o serviço com as medidas de segurança descritas no Acordo de
Tratamento de Dados.

3.2. Manter os dados de cada Cliente isolados dos demais.

3.3. Comunicar mudanças que afetem a integração com antecedência mínima de
[PRAZO] dias, salvo correção urgente de segurança.

## 4. Disponibilidade

4.1. [DEFINIR SLA SÓ DEPOIS DE CONTRATAR INFRAESTRUTURA PAGA — ver
docs/operacao.md.] Enquanto isso, o serviço é oferecido sem garantia de
disponibilidade mínima.

4.2. Manutenções programadas serão avisadas com [PRAZO] de antecedência.

## 5. Suspensão e desativação

5.1. O Provedor pode desativar uma aplicação em caso de violação destes termos
ou de risco à segurança de outros clientes. Desativar encerra imediatamente as
sessões dos usuários finais daquela aplicação.

5.2. A desativação não apaga dados. A eliminação segue o Acordo de Tratamento
de Dados.

## 6. Preço e pagamento

[DEFINIR modelo de cobrança: por aplicação, por usuário ativo mensal, faixas.]

## 7. Limitação de responsabilidade

[REDAÇÃO JURÍDICA.]

## 8. Rescisão

8.1. Qualquer parte pode rescindir com [PRAZO] dias de aviso.

8.2. Na rescisão, o Cliente pode solicitar exportação dos dados antes da
eliminação.

## 9. Foro

Fica eleito o foro de [FORO].
