import "server-only";

import type { Prisma } from "@/generated/prisma/client";

// Mesma lógica do script de backfill (scripts/backfill-organizacoes.mjs) —
// duplicada de propósito, não importada de lá: aquele script roda em node
// puro fora do TypeScript/Next.js (mesmo motivo já documentado em
// rotacionar-chave-mfa.mjs), não dá pra importar um módulo daqui.
function gerarSlugBase(fonte: string): string {
  const normalizado = fonte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (normalizado || "organizacao").slice(0, 40);
}

// O slug é único DENTRO da aplicação, não globalmente — por isso a busca
// leva aplicacaoId junto. Sem isso, o primeiro cliente a registrar "acme"
// forçaria todos os outros a usar "acme-a1b2c3", vazando pela colisão a
// existência de uma organização de outro cliente.
async function gerarSlugUnico(
  tx: Prisma.TransactionClient,
  aplicacaoId: string,
  base: string,
): Promise<string> {
  const existeBase = await tx.organizacao.findUnique({
    where: { aplicacaoId_slug: { aplicacaoId, slug: base } },
  });
  if (!existeBase) return base;
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const sufixo = Math.random().toString(36).slice(2, 8);
    const candidato = `${base}-${sufixo}`;
    const existe = await tx.organizacao.findUnique({
      where: { aplicacaoId_slug: { aplicacaoId, slug: candidato } },
    });
    if (!existe) return candidato;
  }
  throw new Error(`Não foi possível gerar um slug único a partir de "${base}".`);
}

// Cria a organização "pessoal" que todo cadastro novo ganha automaticamente
// (mesmo princípio do backfill: toda conta é dona de pelo menos uma
// organização) — chamado dentro da MESMA transação que cria o Usuario, pra
// nunca existir um usuário sem organização nem vice-versa.
export async function criarOrganizacaoPessoal(
  tx: Prisma.TransactionClient,
  usuario: { id: string; nome: string; email: string; aplicacaoId: string },
) {
  const fonteSlug = usuario.nome.trim() || usuario.email.split("@")[0];
  const slug = await gerarSlugUnico(tx, usuario.aplicacaoId, gerarSlugBase(fonteSlug));
  const organizacao = await tx.organizacao.create({
    data: { nome: `${usuario.nome} (pessoal)`, slug, aplicacaoId: usuario.aplicacaoId },
  });
  await tx.membro.create({
    data: { organizacaoId: organizacao.id, usuarioId: usuario.id, papel: "dono" },
  });
  return organizacao;
}

// Cria uma organização NOVA (não a pessoal automática do cadastro) —
// usada por POST /api/auth/organizacoes, quando o usuário já autenticado
// decide criar mais uma (ex.: separar trabalho de projetos pessoais).
export async function criarOrganizacao(
  tx: Prisma.TransactionClient,
  aplicacaoId: string,
  nome: string,
  donoId: string,
) {
  const slug = await gerarSlugUnico(tx, aplicacaoId, gerarSlugBase(nome));
  const organizacao = await tx.organizacao.create({ data: { nome, slug, aplicacaoId } });
  await tx.membro.create({
    data: { organizacaoId: organizacao.id, usuarioId: donoId, papel: "dono" },
  });
  return organizacao;
}
