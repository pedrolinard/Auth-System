import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registrarEvento } from "@/lib/auditoria";
import { enviarEmailRedefinicaoSenha } from "@/lib/email";
import {
  limiteExcedido,
  limiteExcedidoPorEmail,
  obterIp,
  registrarTentativaEmail,
  registrarTentativaIp,
} from "@/lib/rateLimit";
import { gerarTokenRedefinicaoSenha } from "@/lib/token";
import { esquemaEsqueciSenha } from "@/lib/validacao";

const MAX_TENTATIVAS_RECUPERACAO = 5;
const JANELA_RECUPERACAO_MS = 60 * 60 * 1000;

// Limite por CONTA além do de IP: sem ele, dá pra floodar a caixa de entrada
// de uma vítima pedindo redefinição sem parar, só trocando de IP a cada
// tentativa (cada IP isolado fica abaixo do limite acima). 3 pedidos/hora
// por e-mail cobre o uso legítimo (a pessoa não pediu, não recebeu, pede de
// novo) sem virar vetor de e-mail-bombing.
const MAX_RECUPERACAO_POR_EMAIL = 3;

export async function POST(req: Request) {
  const ip = obterIp(req);
  if (
    await limiteExcedido({
      ip,
      evento: "recuperacao_tentativa",
      maximo: MAX_TENTATIVAS_RECUPERACAO,
    })
  ) {
    return NextResponse.json(
      { erro: "Muitas tentativas. Tente novamente mais tarde." },
      { status: 429 },
    );
  }
  await registrarEvento({ req, evento: "recuperacao_tentativa" });
  await registrarTentativaIp({
    ip,
    evento: "recuperacao_tentativa",
    janelaMs: JANELA_RECUPERACAO_MS,
  });

  const corpo = await req.json().catch(() => null);
  const dadosValidados = esquemaEsqueciSenha.safeParse(corpo);
  if (!dadosValidados.success) {
    return NextResponse.json(
      { erro: "Dados inválidos.", detalhes: dadosValidados.error.flatten() },
      { status: 400 },
    );
  }

  const { email } = dadosValidados.data;

  // Conta os pedidos por e-mail (registrados abaixo pra TODO pedido, exista
  // ou não a conta) — quando estoura, a rota continua respondendo a mesma
  // coisa mas NÃO manda e-mail nenhum. Anti-enumeração: um atacante não
  // consegue diferenciar "limite de flood atingido" de "e-mail não existe".
  const floodDeEmail = await limiteExcedidoPorEmail({
    email,
    evento: "recuperacao_email",
    maximo: MAX_RECUPERACAO_POR_EMAIL,
  });
  await registrarEvento({ req, evento: "recuperacao_email", email });
  await registrarTentativaEmail({
    email,
    evento: "recuperacao_email",
    janelaMs: JANELA_RECUPERACAO_MS,
  });

  const usuario = await prisma.usuario.findUnique({ where: { email } });

  // Sempre responde com a mesma mensagem genérica, exista ou não o e-mail —
  // evita que a rota seja usada para descobrir quais e-mails têm conta
  // (mesmo princípio já aplicado em /login, que não distingue e-mail
  // inexistente de senha errada).
  if (usuario && !floodDeEmail) {
    const token = await gerarTokenRedefinicaoSenha(usuario.id);
    const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
    await enviarEmailRedefinicaoSenha(email, `${baseUrl}/redefinir-senha?token=${token}`);
  }

  return NextResponse.json({
    mensagem: "Se esse e-mail estiver cadastrado, um link de redefinição foi enviado.",
  });
}
