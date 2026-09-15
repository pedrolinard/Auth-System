import "server-only";

import { prisma } from "@/lib/db";
import {
  definirCookieAcesso,
  definirCookieAtualizacao,
  definirCookieCsrf,
} from "@/lib/cookies";
import { gerarTokenCsrf } from "@/lib/csrf";
import { obterGeo } from "@/lib/geo";
import { criarOrganizacaoPessoal } from "@/lib/organizacao";
import { obterIp } from "@/lib/rateLimit";
import { revogacao } from "@/lib/revogacao";
import {
  estaSuspenso,
  filtroMembroNaoSuspenso,
  mensagemContaSuspensa,
} from "@/lib/suspensao";
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
  // Vem da própria linha do usuário, nunca do header da requisição: o header
  // diz onde procurar a conta, mas quem a conta é depois de encontrada é o
  // banco que decide. Confiar no header aqui deixaria emitir um token com a
  // aplicação de outro cliente.
  aplicacaoId: string;
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
//
// Organização em que a pessoa está suspensa é pulada: a suspensão vale só
// dentro dela, então o login abre na próxima acessível.
export async function resolverOrganizacaoAtiva(usuarioId: string) {
  const membro = await prisma.membro.findFirst({
    where: { usuarioId, ...filtroMembroNaoSuspenso() },
    orderBy: { criadoEm: "asc" },
    select: { organizacaoId: true, papel: true },
  });
  if (membro) {
    return { organizacaoId: membro.organizacaoId, papelOrganizacao: membro.papel };
  }

  // Conta SEM NENHUM Membro: ganha a organização pessoal aqui, na hora. Isso
  // não deveria existir (o cadastro cria a organização junto, e o backfill de
  // 2026-09-08 cobriu as contas antigas), mas existiu em produção — contas
  // criadas depois do backfill e antes do deploy do multi-tenant, pelo
  // código antigo que não criava organização. Falhar alto aqui significava
  // login com 500 sem corpo, para sempre, até alguém rodar SQL à mão. Criar a
  // organização pessoal é exatamente o estado que o cadastro atual produziria,
  // então consertar no caminho é seguro.
  //
  // Só pra conta sem nenhum vínculo: quem tem organizações mas está suspenso
  // em todas continua recusado (bloqueioPorSuspensao, antes de chegar aqui) —
  // dar a essa pessoa uma organização nova seria driblar a suspensão.
  const totalMembros = await prisma.membro.count({ where: { usuarioId } });
  if (totalMembros > 0) {
    throw new Error(`Usuário ${usuarioId} está suspenso em todas as organizações.`);
  }
  const usuario = await prisma.usuario.findUniqueOrThrow({
    where: { id: usuarioId },
    select: { id: true, nome: true, email: true, aplicacaoId: true },
  });
  const organizacao = await prisma.$transaction((tx) => criarOrganizacaoPessoal(tx, usuario));
  console.warn(`Usuário ${usuarioId} estava sem organização — organização pessoal criada no login.`);
  return { organizacaoId: organizacao.id, papelOrganizacao: "dono" as const };
}

// Checagem de suspensão das rotas de login (senha, MFA, código de backup,
// passkey): devolve a mensagem de recusa quando a conta está suspensa em
// TODAS as organizações de que participa, e null quando existe pelo menos
// uma em que a sessão pode abrir. Conta sem nenhum Membro devolve null de
// propósito — isso é bug de dado, não suspensão, e resolverOrganizacaoAtiva
// cria a organização pessoal que faltava.
export async function bloqueioPorSuspensao(usuarioId: string): Promise<string | null> {
  const membros = await prisma.membro.findMany({
    where: { usuarioId },
    select: { suspenso: true, suspensoAte: true, suspensoMotivo: true },
  });
  if (membros.length === 0 || membros.some((m) => !estaSuspenso(m))) return null;
  return mensagemContaSuspensa(membros);
}

// Mesma forma de resolverOrganizacaoAtiva, mas pra uma organização
// ESPECÍFICA em vez da primeira — usado só por POST
// /api/auth/organizacoes/[id]/entrar (troca de organização). A rota já
// confere a filiação antes de chamar (pra devolver um 404 limpo); esta
// checagem aqui é defesa em profundidade, não o único lugar que valida —
// nunca confia num organizacaoId vindo de fora sem reler o Membro.
async function obterOrganizacaoOuFalhar(usuarioId: string, organizacaoId: string) {
  const membro = await prisma.membro.findUnique({
    where: { organizacaoId_usuarioId: { organizacaoId, usuarioId } },
    select: { organizacaoId: true, papel: true, suspenso: true, suspensoAte: true },
  });
  if (!membro) {
    throw new Error(`Usuário ${usuarioId} não é membro da organização ${organizacaoId}.`);
  }
  if (estaSuspenso(membro)) {
    throw new Error(`Usuário ${usuarioId} está suspenso na organização ${organizacaoId}.`);
  }
  return { organizacaoId: membro.organizacaoId, papelOrganizacao: membro.papel };
}

// Emite o par de tokens (acesso + atualização), persiste o hash do token de
// atualização e seta o cookie httpOnly. Usado tanto pelo login direto quanto
// pela conclusão do desafio de MFA, para os dois caminhos terminarem no mesmo
// formato de sessão. `organizacaoIdDesejada` é opcional — só a troca de
// organização passa (todos os outros chamadores continuam pegando a
// primeira organização do usuário, sem precisar saber que esse parâmetro
// existe).
export async function criarSessao(
  usuario: UsuarioParaSessao,
  req: Request,
  organizacaoIdDesejada?: string,
  opcoes: {
    // false no login hospedado (OpenID Connect, src/lib/oidc.ts): os tokens
    // vão pra aplicação cliente pelo endpoint de token, e um usuário de OUTRA
    // aplicação nunca pode ganhar cookie de sessão no domínio do provedor —
    // viraria sessão do painel.
    definirCookies?: boolean;
  } = {},
) {
  const definirCookies = opcoes.definirCookies ?? true;
  const { organizacaoId, papelOrganizacao } = organizacaoIdDesejada
    ? await obterOrganizacaoOuFalhar(usuario.id, organizacaoIdDesejada)
    : await resolverOrganizacaoAtiva(usuario.id);

  const tokenAcesso = await gerarTokenAcesso({
    sub: usuario.id,
    email: usuario.email,
    papel: usuario.papel,
    aplicacaoId: usuario.aplicacaoId,
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
    // `revogadoEm: null` de novo aqui, não só no findMany: se uma dessas
    // sessões for rotacionada entre a leitura e este update, o motivo
    // "rotacao" dela não pode virar "limite_sessoes" — é ele que mantém a
    // detecção de reuso sobre o token antigo (ver revogacao.ts).
    await prisma.tokenAtualizacao.updateMany({
      where: { id: { in: sessoesExcedentes.map((s) => s.id) }, revogadoEm: null },
      data: revogacao("limite_sessoes"),
    });
  }

  if (definirCookies) {
    await definirCookieAtualizacao(tokenAtualizacao);
    await definirCookieAcesso(tokenAcesso);
    await definirCookieCsrf(gerarTokenCsrf());
  }

  return {
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email },
    tokenAcesso,
    tokenAtualizacao,
  };
}

/** Mesmo que criarSessao, com o id da sessão criada (pra ligar ao código OIDC). */
export async function criarSessaoSemCookies(usuario: UsuarioParaSessao, req: Request) {
  const resultado = await criarSessao(usuario, req, undefined, { definirCookies: false });
  const sessao = await prisma.tokenAtualizacao.findUniqueOrThrow({
    where: { tokenHash: hashToken(resultado.tokenAtualizacao) },
    select: { id: true, organizacaoId: true },
  });
  return { ...resultado, sessaoId: sessao.id, organizacaoId: sessao.organizacaoId };
}
