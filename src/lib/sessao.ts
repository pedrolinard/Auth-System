import "server-only";

import { prisma } from "@/lib/db";
import {
  definirCookieAcesso,
  definirCookieAtualizacao,
  definirCookieCsrf,
} from "@/lib/cookies";
import { gerarTokenCsrf } from "@/lib/csrf";
import { obterGeo } from "@/lib/geo";
import { obterIp } from "@/lib/rateLimit";
import {
  gerarTokenAcesso,
  gerarTokenAtualizacao,
  hashToken,
  type Papel,
} from "@/lib/token";

type UsuarioParaSessao = {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
};

// Sem limite, um usuário podia acumular sessões ativas indefinidamente (cada
// login novo só soma, nunca substitui). 5 cobre o uso normal (celular,
// notebook pessoal, notebook de trabalho, tablet, +1 de folga) sem soar
// arbitrário demais.
export const MAX_SESSOES_SIMULTANEAS = 5;

// Resolve a organização ATIVA de uma sessão nova: por enquanto (multi-tenant
// fase 2 — trocar de organização e ter mais de uma na prática é fase 5), usa
// a primeira organização de que o usuário é membro (ordem de entrada — pra
// conta migrada do backfill, é sempre a organização pessoal criada nela; pra
// conta nova, é a única que o cadastro cria). Centralizado aqui em vez de em
// cada chamador de criarSessao (login, MFA, passkey) — todos ganham o
// comportamento junto, sem precisar mudar a assinatura de cada rota.
// Exportado pra /api/auth/atualizar reusar como fallback quando uma sessão
// antiga (emitida antes da coluna organizacaoId existir em
// tokens_atualizacao) é renovada — nesse caso não tem organizacaoId salva no
// TokenAtualizacao pra reler o papel, então resolve do mesmo jeito que uma
// sessão nova resolveria.
export async function resolverOrganizacaoAtiva(usuarioId: string) {
  const membro = await prisma.membro.findFirst({
    where: { usuarioId },
    orderBy: { criadoEm: "asc" },
    select: { organizacaoId: true, papel: true },
  });
  if (!membro) {
    // Não deveria acontecer: cadastro (fase 2) sempre cria uma organização
    // junto, e toda conta anterior passou pelo backfill (fase 1). Se
    // acontecer mesmo assim, é bug — melhor falhar alto aqui do que emitir
    // um token sem organizacaoId que quebraria em qualquer rota de domínio.
    throw new Error(
      `Usuário ${usuarioId} não pertence a nenhuma organização — rode npm run backfill:organizacoes.`,
    );
  }
  return { organizacaoId: membro.organizacaoId, papelOrganizacao: membro.papel };
}

// Emite o par de tokens (acesso + atualização), persiste o hash do token de
// atualização e seta o cookie httpOnly. Usado tanto pelo login direto quanto
// pela conclusão do desafio de MFA, para os dois caminhos terminarem no mesmo
// formato de sessão.
export async function criarSessao(usuario: UsuarioParaSessao, req: Request) {
  const { organizacaoId, papelOrganizacao } = await resolverOrganizacaoAtiva(usuario.id);

  const tokenAcesso = await gerarTokenAcesso({
    sub: usuario.id,
    email: usuario.email,
    papel: usuario.papel,
    organizacaoId,
    papelOrganizacao,
  });
  const { token: tokenAtualizacao, expiraEm } = await gerarTokenAtualizacao(
    usuario.id,
  );
  const geo = obterGeo(req);

  await prisma.tokenAtualizacao.create({
    data: {
      tokenHash: hashToken(tokenAtualizacao),
      usuarioId: usuario.id,
      // A sessão inteira (refresh incluído) fica presa a esta organização —
      // é o que permite /api/auth/atualizar reemitir o access token pra
      // MESMA organização sem o cliente precisar informar de novo.
      organizacaoId,
      expiraEm,
      ip: obterIp(req),
      userAgent: req.headers.get("user-agent"),
      geoCidade: geo.cidade,
      geoRegiao: geo.regiao,
      geoPais: geo.pais,
    },
  });

  // Limite de sessões simultâneas: mantém só as MAX_SESSOES_SIMULTANEAS mais
  // recentes (a que acabou de ser criada inclusa) e revoga o excedente mais
  // antigo. Roda a cada sessão nova (login ou conclusão de MFA) em vez de só
  // na leitura da lista, pra a sessão revogada já não valer mais mesmo que o
  // dono nunca abra a tela de "sessões ativas".
  const sessoesExcedentes = await prisma.tokenAtualizacao.findMany({
    where: { usuarioId: usuario.id, revogadoEm: null, expiraEm: { gt: new Date() } },
    orderBy: { criadoEm: "desc" },
    select: { id: true },
    skip: MAX_SESSOES_SIMULTANEAS,
  });
  if (sessoesExcedentes.length > 0) {
    await prisma.tokenAtualizacao.updateMany({
      where: { id: { in: sessoesExcedentes.map((s) => s.id) } },
      data: { revogadoEm: new Date() },
    });
  }

  await definirCookieAtualizacao(tokenAtualizacao);
  await definirCookieAcesso(tokenAcesso);
  await definirCookieCsrf(gerarTokenCsrf());

  return {
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email },
    tokenAcesso,
    tokenAtualizacao,
  };
}
