import "server-only";

const URL_VERIFICACAO_TURNSTILE = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Sem TURNSTILE_SECRET_KEY (dev/test sem provedor configurado): a
// verificação é pulada e o fluxo segue normalmente, mesmo princípio de
// fallback do RESEND_API_KEY em email.ts — não trava o ambiente local por
// falta de uma chave de produção. A parte visual (widget no front) fica
// fora deste escopo; aqui só o gancho server-side.
export function turnstileConfigurado(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

// Verifica um token do Cloudflare Turnstile contra a API oficial de
// siteverify. Fail-closed quando configurado: qualquer problema (token
// ausente, resposta negativa, erro de rede) reprova — diferente do envio de
// e-mail (best-effort), aqui a verificação É a barreira de segurança, então
// uma falha silenciosa "passando direto" anularia o propósito do CAPTCHA.
export async function verificarTurnstile(
  token: string | undefined,
  ip: string | null,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;

  try {
    const resposta = await fetch(URL_VERIFICACAO_TURNSTILE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        response: token,
        ...(ip ? { remoteip: ip } : {}),
      }),
    });

    if (!resposta.ok) return false;

    const resultado = (await resposta.json()) as { success?: boolean };
    return resultado.success === true;
  } catch (erro) {
    console.error("Falha ao verificar token do Turnstile:", erro);
    return false;
  }
}
