import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { enviarEmailReusoTokenDetectado } from "@/lib/email";
import {
  definirCookieAcesso,
  definirCookieAtualizacao,
  definirCookieCsrf,
  obterCookieAtualizacao,
  obterCookieCsrf,
} from "@/lib/cookies";
import { csrfValido, gerarTokenCsrf } from "@/lib/csrf";
import { obterGeo } from "@/lib/geo";
import { limiteExcedido, obterIp, registrarTentativaIp } from "@/lib/rateLimit";
import {
  gerarTokenAcesso,
  gerarTokenAtualizacao,
  hashToken,
  verificarTokenAtualizacao,
} from "@/lib/token";
import { esquemaAtualizacao } from "@/lib/validacao";

// A renovação faz `verificarTokenAtualizacao` + um `findUnique` a cada
// chamada; sem limite, dava pra martelar o endpoint com lixo (cada tentativa
// custa CPU de verificação de JWT + uma ida ao banco). Conta só as FALHAS
// por IP — uma renovação legítima não escreve nada — com folga pra não
// travar várias sessões atrás do mesmo NAT.
const MAX_FALHAS_ATUALIZAR = 20;
const JANELA_ATUALIZAR_MS = 15 * 60 * 1000;

const RESPOSTA_TOKEN_INVALIDO = { erro: "Token de atualização inválido ou expirado." };

export async function POST(req: Request) {
  if (!csrfValido(req, await obterCookieCsrf())) {
    return NextResponse.json({ erro: "Token CSRF inválido." }, { status: 403 });
  }

  const ip = obterIp(req);
  if (
    await limiteExcedido({
      ip,
      evento: "atualizar_falha",
      maximo: MAX_FALHAS_ATUALIZAR,
    })
  ) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }

  // Token apresentado mas inválido/desconhecido/expirado — o sinal que o
  // rate limit acima conta. Só é chamado nos caminhos de token ruim, nunca
  // numa renovação bem-sucedida.
  const recusarTokenInvalido = async () => {
    await registrarEvento({ req, evento: "atualizar_falha" });
    await registrarTentativaIp({ ip, evento: "atualizar_falha", janelaMs: JANELA_ATUALIZAR_MS });
    return NextResponse.json(RESPOSTA_TOKEN_INVALIDO, { status: 401 });
  };

  const corpo = await req.json().catch(() => ({}));
  const tokenDoCorpo = esquemaAtualizacao.safeParse(corpo);

  // Aceita o token de atualização tanto pelo cookie (fluxo de navegador)
  // quanto pelo corpo da requisição (fluxo de apps/serviços sem cookies).
  const tokenRecebido =
    (await obterCookieAtualizacao()) ??
    (tokenDoCorpo.success ? tokenDoCorpo.data.tokenAtualizacao : undefined);

  if (!tokenRecebido) {
    return NextResponse.json(
      { erro: "Token de atualização não informado." },
      { status: 401 },
    );
  }

  const payload = await verificarTokenAtualizacao(tokenRecebido);
  if (!payload) {
    return recusarTokenInvalido();
  }

  const tokenHash = hashToken(tokenRecebido);
  const registroToken = await prisma.tokenAtualizacao.findUnique({
    where: { tokenHash },
    include: { usuario: true },
  });

  if (!registroToken) {
    return recusarTokenInvalido();
  }

  // Um token de atualização já revogado sendo reapresentado é o sinal
  // clássico de roubo: a rotação já emitiu um substituto, então só existem
  // duas explicações — o dono legítimo reusou uma cópia antiga por engano,
  // ou um atacante está com o token vazado. Não dá pra distinguir os dois,
  // então a resposta segura é derrubar a família inteira (todas as sessões
  // do usuário), invalidando tanto o atacante quanto a sessão legítima.
  if (registroToken.revogadoEm) {
    await prisma.tokenAtualizacao.updateMany({
      where: { usuarioId: registroToken.usuarioId, revogadoEm: null },
      data: { revogadoEm: new Date() },
    });
    await registrarEvento({
      req,
      evento: "reuso_token_detectado",
      usuarioId: registroToken.usuarioId,
    });
    await enviarEmailReusoTokenDetectado(registroToken.usuario.email);
    return recusarTokenInvalido();
  }

  if (registroToken.expiraEm < new Date()) {
    return recusarTokenInvalido();
  }

  // Rotação: revoga o token usado e emite um novo par de tokens. IP/UA/geo
  // são recapturados da requisição de refresh (não copiados do token
  // antigo) pra a lista de sessões refletir onde o dispositivo está agora,
  // não onde estava no login original.
  const { token: novoTokenAtualizacao, expiraEm: novaExpiracao } =
    await gerarTokenAtualizacao(registroToken.usuarioId);
  const geo = obterGeo(req);

  try {
    await prisma.$transaction([
      prisma.tokenAtualizacao.update({
        where: { id: registroToken.id },
        data: { revogadoEm: new Date() },
      }),
      prisma.tokenAtualizacao.create({
        data: {
          tokenHash: hashToken(novoTokenAtualizacao),
          usuarioId: registroToken.usuarioId,
          expiraEm: novaExpiracao,
          ip: obterIp(req),
          userAgent: req.headers.get("user-agent"),
          geoCidade: geo.cidade,
          geoRegiao: geo.regiao,
          geoPais: geo.pais,
        },
      }),
    ]);
  } catch (erro) {
    console.error("Falha ao rotacionar token de atualização:", erro);
    return NextResponse.json(
      { erro: "Não foi possível renovar a sessão. Tente novamente." },
      { status: 500 },
    );
  }

  const novoTokenAcesso = await gerarTokenAcesso({
    sub: registroToken.usuario.id,
    email: registroToken.usuario.email,
    papel: registroToken.usuario.papel,
  });

  await definirCookieAtualizacao(novoTokenAtualizacao);
  await definirCookieAcesso(novoTokenAcesso);
  await definirCookieCsrf(gerarTokenCsrf());

  return NextResponse.json({
    tokenAcesso: novoTokenAcesso,
    tokenAtualizacao: novoTokenAtualizacao,
  });
}
