// Fase 1 do multi-tenant: toda conta que já existe (criada antes da
// Organizacao existir) ganha uma organização padrão, com essa conta como
// dona — sem isso, a Fase 2 (login/cadastro passam a exigir uma
// organizacaoId pra emitir o access token) deixaria contas antigas sem
// conseguir logar.
//
// Idempotente: um usuário que já tem alguma linha em `membros` é pulado —
// rodar de novo depois de já ter rodado não duplica nada.
//
// node -r dotenv/config scripts/backfill-organizacoes.mjs dotenv_config_path=.env

import { randomBytes } from "node:crypto";
import pg from "pg";

function requerEnv(nome) {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`Defina a variável de ambiente ${nome} antes de rodar este script.`);
    process.exit(1);
  }
  return valor;
}

// Mesmo formato VISUAL dos ids que o Prisma gera pro resto do app (cuid(),
// via @paralleldrive/cuid2 internamente) — não o mesmo algoritmo (esse
// pacote não é dependência direta deste projeto, só do Prisma por baixo dos
// panos, e não dá pra importar um módulo TS/app daqui, mesmo motivo já
// documentado em rotacionar-chave-mfa.mjs). Sem isso, toda linha criada por
// este script tinha um id com "cara" de UUID, visualmente diferente de
// qualquer linha criada pela aplicação depois — cosmético (a coluna é só
// String @id, sem validação de formato), mas evitável.
function gerarId() {
  return `c${randomBytes(12).toString("hex").slice(0, 23)}`;
}

// Mesmo espírito de slug de qualquer gerador simples: minúsculas, sem
// acento, só [a-z0-9-]. Base curta o bastante pra sobrar espaço pro sufixo
// de desempate.
function gerarSlugBase(nome, email) {
  const fonte = nome?.trim() ? nome : email.split("@")[0];
  const normalizado = fonte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (normalizado || "organizacao").slice(0, 40);
}

async function slugDisponivel(client, slug) {
  const { rows } = await client.query('SELECT 1 FROM organizacoes WHERE slug = $1', [slug]);
  return rows.length === 0;
}

// Tenta o slug base; em colisão, anexa um sufixo aleatório curto (não um
// contador sequencial — evita uma segunda ida ao banco por tentativa em
// cadastros em massa, e não vaza quantas organizações concorrentes existem
// com nome parecido).
async function gerarSlugUnico(client, base) {
  if (await slugDisponivel(client, base)) return base;
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const sufixo = randomBytes(3).toString("hex");
    const candidato = `${base}-${sufixo}`;
    if (await slugDisponivel(client, candidato)) return candidato;
  }
  throw new Error(`Não foi possível gerar um slug único a partir de "${base}".`);
}

async function principal() {
  const client = new pg.Client({ connectionString: requerEnv("DATABASE_URL") });
  await client.connect();

  const { rows: usuarios } = await client.query(`
    SELECT u.id, u.nome, u.email
    FROM usuarios u
    LEFT JOIN membros m ON m."usuarioId" = u.id
    WHERE m.id IS NULL
    ORDER BY u."criadoEm" ASC
  `);
  console.log(`${usuarios.length} usuário(s) sem organização — criando organização padrão pra cada um.`);

  let criadas = 0;
  let falhas = 0;

  for (const usuario of usuarios) {
    const slugBase = gerarSlugBase(usuario.nome, usuario.email);
    try {
      await client.query("BEGIN");
      const slug = await gerarSlugUnico(client, slugBase);
      const nomeOrganizacao = usuario.nome?.trim()
        ? `${usuario.nome} (pessoal)`
        : "Organização pessoal";

      const { rows: [organizacao] } = await client.query(
        `INSERT INTO organizacoes (id, nome, slug, "criadoEm")
         VALUES ($1, $2, $3, now())
         RETURNING id`,
        [gerarId(), nomeOrganizacao, slug],
      );
      await client.query(
        `INSERT INTO membros (id, "organizacaoId", "usuarioId", papel, "criadoEm")
         VALUES ($1, $2, $3, 'dono', now())`,
        [gerarId(), organizacao.id, usuario.id],
      );
      await client.query("COMMIT");
      criadas++;
    } catch (erro) {
      await client.query("ROLLBACK");
      falhas++;
      console.error(`Usuário ${usuario.id} (${usuario.email}): falhou ao criar organização —`, erro.message);
    }
  }

  console.log(`Backfill concluído: ${criadas} organização(ões) criada(s), ${falhas} falha(s).`);

  await client.end();
  if (falhas > 0) process.exit(1);
}

await principal();
