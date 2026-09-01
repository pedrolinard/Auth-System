import "server-only";

import type { Prisma } from "@/generated/prisma/client";

// Mesma lógica do script de backfill (scripts/backfill-organizacoes.mjs) —
// duplicada de propósito, não importada de lá: aquele script roda em node
// puro fora do TypeScript/Next.js (mesmo motivo já documentado em
// rotacionar-chave-mfa.mjs), não dá pra importar um módulo daqui.
function gerarSlugBase(nome: string | undefined, email: string): string {
  const fonte = nome?.trim() ? nome : email.split("@")[0];
  const normalizado = fonte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (normalizado || "organizacao").slice(0, 40);
}

async function gerarSlugUnico(
  tx: Prisma.TransactionClient,
  base: string,
): Promise<string> {
  const existeBase = await tx.organizacao.findUnique({ where: { slug: base } });
  if (!existeBase) return base;
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const sufixo = Math.random().toString(36).slice(2, 8);
    const candidato = `${base}-${sufixo}`;
    const existe = await tx.organizacao.findUnique({ where: { slug: candidato } });
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
  usuario: { id: string; nome: string; email: string },
) {
  const slug = await gerarSlugUnico(tx, gerarSlugBase(usuario.nome, usuario.email));
  const organizacao = await tx.organizacao.create({
    data: { nome: `${usuario.nome} (pessoal)`, slug },
  });
  await tx.membro.create({
    data: { organizacaoId: organizacao.id, usuarioId: usuario.id, papel: "dono" },
  });
  return organizacao;
}
