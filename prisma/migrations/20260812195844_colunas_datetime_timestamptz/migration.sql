-- Troca DateTime de `timestamp` (sem fuso) para `timestamptz` em todas as
-- colunas. Sem essa mudança, o Postgres grava só os números "de parede" sob
-- o fuso da SESSÃO que fez o INSERT (sempre GMT nas conexões deste app, já
-- que nenhuma delas roda `SET TIME ZONE`), e devolve texto sem nenhuma marca
-- de fuso — o parser do node-postgres (postgres-date) então reconstrói esse
-- texto com o construtor de HORÁRIO LOCAL do processo que está lendo, não
-- UTC. No Vercel (roda em UTC) isso coincide por acaso e não dá pra notar;
-- rodando um script fora dele num fuso diferente, a mesma linha lida chega
-- deslocada pelo offset local (ex.: ~3h adiantada no horário de Brasília).
--
-- `USING ... AT TIME ZONE 'UTC'` é explícito de propósito (em vez de deixar
-- o cast implícito do Postgres, que reinterpretaria os valores existentes
-- sob o fuso da sessão QUE RODA ESTA MIGRATION): como todo dado já gravado
-- tem os números batendo com UTC de verdade (confirmado; a sessão de
-- escrita sempre foi GMT), a leitura correta é "estes números JÁ SÃO UTC",
-- não "converta estes números como se fossem hora local daqui".
-- AlterTable
ALTER TABLE "codigos_backup_mfa"
  ALTER COLUMN "usadoEm" TYPE TIMESTAMPTZ(3) USING "usadoEm" AT TIME ZONE 'UTC',
  ALTER COLUMN "criadoEm" TYPE TIMESTAMPTZ(3) USING "criadoEm" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "desafios_mfa_consumidos"
  ALTER COLUMN "expiraEm" TYPE TIMESTAMPTZ(3) USING "expiraEm" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "logs_auditoria"
  ALTER COLUMN "criadoEm" TYPE TIMESTAMPTZ(3) USING "criadoEm" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "tokens_atualizacao"
  ALTER COLUMN "criadoEm" TYPE TIMESTAMPTZ(3) USING "criadoEm" AT TIME ZONE 'UTC',
  ALTER COLUMN "expiraEm" TYPE TIMESTAMPTZ(3) USING "expiraEm" AT TIME ZONE 'UTC',
  ALTER COLUMN "revogadoEm" TYPE TIMESTAMPTZ(3) USING "revogadoEm" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "usuarios"
  ALTER COLUMN "criadoEm" TYPE TIMESTAMPTZ(3) USING "criadoEm" AT TIME ZONE 'UTC',
  ALTER COLUMN "atualizadoEm" TYPE TIMESTAMPTZ(3) USING "atualizadoEm" AT TIME ZONE 'UTC',
  ALTER COLUMN "suspensoAte" TYPE TIMESTAMPTZ(3) USING "suspensoAte" AT TIME ZONE 'UTC',
  ALTER COLUMN "senhaAlteradaEm" TYPE TIMESTAMPTZ(3) USING "senhaAlteradaEm" AT TIME ZONE 'UTC';
