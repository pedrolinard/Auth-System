import "server-only";
import { createHash } from "node:crypto";

const URL_PWNED_PASSWORDS = "https://api.pwnedpasswords.com/range/";

// k-anonymity: só os 5 primeiros caracteres do hash SHA-1 da senha saem da
// máquina do usuário (aqui, do servidor) — o serviço nunca recebe a senha
// nem o hash completo, só um prefixo compartilhado por milhares de outros
// hashes. Ver https://haveibeenpwned.com/API/v3#PwnedPasswords.
function sha1UpperCase(senha: string): string {
  return createHash("sha1").update(senha, "utf8").digest("hex").toUpperCase();
}

// Best-effort, fail-open: diferente do Turnstile (que É a barreira contra
// automação), essa checagem é uma melhoria de qualidade de senha — um erro de
// rede ou o serviço fora do ar não pode impedir cadastro/redefinição de
// senha, então qualquer falha aqui deixa passar em vez de bloquear.
export async function senhaFoiVazada(senha: string): Promise<boolean> {
  const hash = sha1UpperCase(senha);
  const prefixo = hash.slice(0, 5);
  const sufixo = hash.slice(5);

  try {
    const resposta = await fetch(`${URL_PWNED_PASSWORDS}${prefixo}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(5000),
    });
    if (!resposta.ok) return false;

    const corpo = await resposta.text();
    return corpo
      .split("\n")
      .some((linha) => linha.trim().split(":")[0] === sufixo);
  } catch (erro) {
    console.error("Falha ao consultar HaveIBeenPwned:", erro);
    return false;
  }
}
