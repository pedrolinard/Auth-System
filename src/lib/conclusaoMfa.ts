import "server-only";

import { prisma } from "@/lib/db";
import { aplicacaoEstaAtiva } from "@/lib/aplicacao";
import { registrarEvento } from "@/lib/auditoria";
import { consumirCodigoBackup, contarCodigosRestantes } from "@/lib/backupMfa";
import { consumirDesafioMfaJti } from "@/lib/desafioMfa";
import type { UsuarioAutenticado } from "@/lib/loginSenha";
import { ErroSegredoMfaIlegivel, verificarCodigoMfaSemReplay } from "@/lib/mfa";
import { limiteExcedido, obterIp, reservarTentativas } from "@/lib/rateLimit";
import { bloqueioPorSuspensao } from "@/lib/sessao";
import { verificarTokenDesafioMfa } from "@/lib/token";
import { esquemaCodigoBackup, esquemaVerificacaoMfa } from "@/lib/validacao";

// Segunda etapa do login (código do autenticador ou código de backup),
// compartilhada por /api/auth/mfa/verificar, /api/auth/mfa/backup e o login
// hospedado do OpenID Connect (/api/oidc/mfa).

const MAX_TENTATIVAS_MFA = 5;
const JANELA_MFA_MS = 5 * 60 * 1000;

// Limite por CONTA, além do por IP: só por IP, quem já tem a senha tentava os
// códigos de 6 dígitos a partir de muitos IPs (e um backend cliente com o
// segredo vazado declararia um IP novo a cada tentativa). A pessoa legítima
// não erra 10 códigos em 15 minutos.
const MAX_FALHAS_MFA_CONTA = 10;
const JANELA_MFA_CONTA_MS = 15 * 60 * 1000;

const DESAFIO_INVALIDO = { erro: "Desafio de MFA inválido ou expirado. Faça login novamente." };
const MUITAS_TENTATIVAS = { erro: "Muitas tentativas. Tente novamente mais tarde." };

export type ResultadoMfa =
  | { tipo: "recusa"; status: number; corpo: Record<string, unknown> }
  | {
      tipo: "autenticado";
      usuario: UsuarioAutenticado;
      lembrarDispositivo: boolean;
      codigosBackupRestantes: number | null;
    };

function recusa(status: number, corpo: Record<string, unknown>): ResultadoMfa {
  return { tipo: "recusa", status, corpo };
}

type Opcoes = {
  // Login hospedado: o desafio de MFA não carrega aplicação, então quem conclui
  // num pedido de autorização precisa ser conta DAQUELA aplicação — senão um
  // mfaToken de outro cliente abriria sessão neste.
  aplicacaoId?: string;
};

type DesafioCarregado =
  | { ok: false; recusa: ResultadoMfa }
  | {
      ok: true;
      payload: NonNullable<Awaited<ReturnType<typeof verificarTokenDesafioMfa>>>;
      usuario: NonNullable<Awaited<ReturnType<typeof prisma.usuario.findUnique>>>;
    };

async function carregarDesafio(mfaToken: string, opcoes: Opcoes): Promise<DesafioCarregado> {
  const payload = await verificarTokenDesafioMfa(mfaToken);
  if (!payload) return { ok: false, recusa: recusa(401, DESAFIO_INVALIDO) };

  const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });
  if (!usuario?.mfaAtivado) return { ok: false, recusa: recusa(401, DESAFIO_INVALIDO) };
  if (opcoes.aplicacaoId && usuario.aplicacaoId !== opcoes.aplicacaoId) {
    return { ok: false, recusa: recusa(401, DESAFIO_INVALIDO) };
  }
  // O desafio foi emitido quando a aplicação estava ativa; se ela foi
  // desativada nos até 5 min seguintes, o login não conclui. Checado ANTES de
  // consumir qualquer código.
  if (!(await aplicacaoEstaAtiva(usuario.aplicacaoId))) {
    return { ok: false, recusa: recusa(400, { erro: "Aplicação inválida ou desativada." }) };
  }
  return { ok: true, payload, usuario };
}

// Cobre a janela entre o desafio (até 5 min) e a confirmação do código: se um
// admin suspender a conta nesse meio-tempo, o login não completa mesmo com o
// código certo. E consome o jti só na conclusão bem-sucedida — um código
// errado não pode "gastar" o desafio.
async function finalizar(
  req: Request,
  usuario: UsuarioAutenticado,
  payload: { jti: string; exp?: number },
): Promise<ResultadoMfa | null> {
  const bloqueio = await bloqueioPorSuspensao(usuario.id);
  if (bloqueio) {
    await registrarEvento({ req, evento: "login_bloqueado_suspenso", usuarioId: usuario.id, email: usuario.email });
    return recusa(403, { erro: bloqueio });
  }
  const desafioAindaValido = await consumirDesafioMfaJti(payload.jti, new Date((payload.exp ?? 0) * 1000));
  if (!desafioAindaValido) return recusa(401, DESAFIO_INVALIDO);
  return null;
}

// Limites por IP e por conta de uma tentativa de código (autenticador ou
// backup), reservados ANTES de conferir o código — ver reservarTentativas.
// As chaves são as mesmas que os checks por IP do início das funções leem.
function limitesMfa(
  ip: string | null,
  usuario: { aplicacaoId: string; email: string },
  evento: "mfa_codigo_falha" | "mfa_backup_falha",
) {
  return [
    { ip, evento, maximo: MAX_TENTATIVAS_MFA, janelaMs: JANELA_MFA_MS },
    {
      aplicacaoId: usuario.aplicacaoId,
      email: usuario.email,
      evento: `${evento}_conta`,
      maximo: MAX_FALHAS_MFA_CONTA,
      janelaMs: JANELA_MFA_CONTA_MS,
    },
  ];
}

export async function concluirMfaComCodigo(req: Request, corpo: unknown, opcoes: Opcoes = {}): Promise<ResultadoMfa> {
  const ip = obterIp(req);
  if (await limiteExcedido({ ip, evento: "mfa_codigo_falha", maximo: MAX_TENTATIVAS_MFA })) {
    return recusa(429, MUITAS_TENTATIVAS);
  }

  const dados = esquemaVerificacaoMfa.safeParse(corpo);
  if (!dados.success) return recusa(400, { erro: "Dados inválidos.", detalhes: dados.error.flatten() });

  const desafio = await carregarDesafio(dados.data.mfaToken, opcoes);
  if (!desafio.ok) return desafio.recusa;
  const { payload, usuario } = desafio;
  if (!usuario.mfaSecret) return recusa(401, DESAFIO_INVALIDO);

  const reserva = await reservarTentativas(limitesMfa(ip, usuario, "mfa_codigo_falha"));
  if (!reserva) return recusa(429, MUITAS_TENTATIVAS);

  let codigoValido: boolean;
  try {
    codigoValido = await verificarCodigoMfaSemReplay(usuario.id, usuario.mfaSecret, usuario.email, dados.data.codigo);
  } catch (erro) {
    // Falha nossa, não da pessoa: não conta como tentativa.
    await reserva.liberar();
    if (erro instanceof ErroSegredoMfaIlegivel) {
      return recusa(500, { erro: "Não foi possível verificar o código agora. Tente novamente mais tarde." });
    }
    throw erro;
  }
  if (!codigoValido) {
    // A reserva fica: é ela que conta esta falha.
    await registrarEvento({ req, evento: "mfa_codigo_falha", usuarioId: usuario.id });
    return recusa(401, { erro: "Código inválido." });
  }
  await reserva.liberar();

  const falha = await finalizar(req, usuario, payload);
  if (falha) return falha;
  return {
    tipo: "autenticado",
    usuario,
    lembrarDispositivo: dados.data.lembrarDispositivo === true,
    codigosBackupRestantes: null,
  };
}

// Login com um código de backup: mesmo desafio, consumindo um recovery code em
// vez do TOTP — caminho pra quando o usuário perdeu o autenticador.
export async function concluirMfaComBackup(req: Request, corpo: unknown, opcoes: Opcoes = {}): Promise<ResultadoMfa> {
  const ip = obterIp(req);
  if (await limiteExcedido({ ip, evento: "mfa_backup_falha", maximo: MAX_TENTATIVAS_MFA })) {
    return recusa(429, MUITAS_TENTATIVAS);
  }

  const dados = esquemaCodigoBackup.safeParse(corpo);
  if (!dados.success) return recusa(400, { erro: "Dados inválidos.", detalhes: dados.error.flatten() });

  const desafio = await carregarDesafio(dados.data.mfaToken, opcoes);
  if (!desafio.ok) return desafio.recusa;
  const { payload, usuario } = desafio;

  const reserva = await reservarTentativas(limitesMfa(ip, usuario, "mfa_backup_falha"));
  if (!reserva) return recusa(429, MUITAS_TENTATIVAS);

  let codigoValido: boolean;
  try {
    codigoValido = await consumirCodigoBackup(usuario.id, dados.data.codigo);
  } catch (erro) {
    await reserva.liberar();
    throw erro;
  }
  if (!codigoValido) {
    // A reserva fica: é ela que conta esta falha.
    await registrarEvento({ req, evento: "mfa_backup_falha", usuarioId: usuario.id });
    return recusa(401, { erro: "Código de backup inválido." });
  }
  await reserva.liberar();

  // O código de backup já foi consumido acima, então não há "tentar de novo"
  // — mas o mfaToken em si ainda não deve servir pra abrir uma segunda sessão.
  const falha = await finalizar(req, usuario, payload);
  if (falha) return falha;

  await registrarEvento({ req, evento: "mfa_backup_sucesso", usuarioId: usuario.id });
  return {
    tipo: "autenticado",
    usuario,
    lembrarDispositivo: false,
    codigosBackupRestantes: await contarCodigosRestantes(usuario.id),
  };
}
