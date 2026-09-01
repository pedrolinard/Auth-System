import * as z from "zod";

// bcryptjs trunca silenciosamente qualquer BYTE além do 72º — sem esse
// limite, "SenhaGigante...(73+ bytes)X" e a mesma senha com o último
// caractere trocado gerariam o mesmo hash, e o usuário nunca perceberia. A
// contagem tem que ser em bytes UTF-8, não em caracteres: `.max(72)` do Zod
// conta code units UTF-16, então uma senha de 72 caracteres com acento ou
// emoji passaria batido e ainda seria truncada pelo bcrypt.
const LIMITE_BYTES_SENHA = 72;
function bytesUtf8(texto: string): number {
  return new TextEncoder().encode(texto).length;
}

const esquemaSenhaForte = z
  .string({ error: "Informe a senha." })
  .min(8, { error: "A senha deve ter pelo menos 8 caracteres." })
  // Teto barato em caracteres antes do refine em bytes — nenhuma senha
  // legítima passa de 72 caracteres (o limite real é 72 bytes), e isso evita
  // rodar o TextEncoder sobre um payload gigante forjado.
  .max(200, { error: "A senha é longa demais." })
  .refine((senha) => bytesUtf8(senha) <= LIMITE_BYTES_SENHA, {
    error: "A senha é longa demais (máximo de 72 bytes; acentos e emoji contam como 2+).",
  })
  .regex(/[a-zA-Z]/, { error: "A senha deve conter pelo menos uma letra." })
  .regex(/[0-9]/, { error: "A senha deve conter pelo menos um número." });

export const esquemaCadastro = z.object({
  nome: z
    .string({ error: "Informe o nome." })
    .trim()
    .min(2, { error: "O nome deve ter pelo menos 2 caracteres." })
    // Teto de tamanho: o nome é renderizado no painel e interpolado em
    // e-mails de segurança — sem limite, um valor gigante infla o banco e
    // polui as duas superfícies. 80 cobre qualquer nome real com folga.
    .max(80, { error: "O nome é longo demais (máximo de 80 caracteres)." }),
  email: z
    .email({ error: "Informe um e-mail válido." })
    .trim()
    .toLowerCase(),
  senha: esquemaSenhaForte,
  // Só exigido de verdade depois de X tentativas da mesma origem (ver
  // rota) — opcional aqui pra não quebrar o fluxo normal sem CAPTCHA.
  turnstileToken: z.string().optional(),
});

export const esquemaLogin = z.object({
  email: z.email({ error: "Informe um e-mail válido." }).trim().toLowerCase(),
  senha: z.string({ error: "Informe a senha." }).min(1, {
    error: "Informe a senha.",
  }),
  turnstileToken: z.string().optional(),
});

export const esquemaAtualizacao = z.object({
  tokenAtualizacao: z.string({ error: "Informe o token de atualização." }),
});

export const esquemaCodigoMfa = z.object({
  codigo: z
    .string({ error: "Informe o código de verificação." })
    .regex(/^\d{6}$/, { error: "O código deve ter 6 dígitos." }),
});

export const esquemaVerificacaoMfa = z.object({
  mfaToken: z.string({ error: "Informe o token de desafio." }),
  codigo: z
    .string({ error: "Informe o código de verificação." })
    .regex(/^\d{6}$/, { error: "O código deve ter 6 dígitos." }),
  // "Lembrar este dispositivo": opcional, default false — pular o MFA nos
  // próximos logins é uma escolha explícita do usuário, nunca o padrão.
  lembrarDispositivo: z.boolean().optional(),
});

// Mesmo alfabeto de src/lib/backupMfa.ts (A-Z e 2-9, sem O/0, I/1, L) —
// hífen central opcional e case-insensitive, já que hashCodigo normaliza os
// dois formatos da mesma forma antes de comparar.
export const esquemaCodigoBackup = z.object({
  mfaToken: z.string({ error: "Informe o token de desafio." }),
  codigo: z
    .string({ error: "Informe o código de backup." })
    .trim()
    .regex(/^[A-HJ-KM-NP-Z2-9]{5}-?[A-HJ-KM-NP-Z2-9]{5}$/i, {
      error: "Código de backup inválido.",
    }),
});

export const esquemaVerificacaoEmail = z.object({
  token: z.string({ error: "Informe o token de verificação." }),
});

export const esquemaEsqueciSenha = z.object({
  email: z.email({ error: "Informe um e-mail válido." }).trim().toLowerCase(),
});

export const esquemaRedefinirSenha = z.object({
  token: z.string({ error: "Informe o token de redefinição." }),
  novaSenha: esquemaSenhaForte,
});

export const esquemaAlterarEmail = z.object({
  novoEmail: z.email({ error: "Informe um e-mail válido." }).trim().toLowerCase(),
  // Trocar o e-mail troca o canal de recuperação da conta — exigir a senha
  // atual impede que um access token roubado (janela de ~15 min) inicie o
  // sequestro sozinho, mesma proteção de excluir a conta / trocar a senha.
  senha: z.string({ error: "Informe a senha atual." }).min(1, { error: "Informe a senha atual." }),
});

export const esquemaConfirmarAlteracaoEmail = z.object({
  token: z.string({ error: "Informe o token de confirmação." }),
});

export const esquemaExcluirConta = z.object({
  senha: z
    .string({ error: "Informe a senha." })
    .min(1, { error: "Informe a senha." }),
});

export const esquemaTrocarSenha = z.object({
  senhaAtual: z
    .string({ error: "Informe a senha atual." })
    .min(1, { error: "Informe a senha atual." }),
  novaSenha: esquemaSenhaForte,
});

// `resposta` é o objeto que @simplewebauthn/browser devolve (attestation ou
// assertion, conforme o fluxo) — validado de verdade por
// verifyRegistrationResponse/verifyAuthenticationResponse do lado servidor,
// não faz sentido duplicar aqui o formato exato de um objeto WebAuthn.
export const esquemaPasskeyRegistroConfirmar = z.object({
  passkeyToken: z.string({ error: "Informe o token do desafio." }),
  resposta: z.record(z.string(), z.unknown()),
  nome: z.string().trim().max(60).optional(),
});

export const esquemaPasskeyLoginConfirmar = z.object({
  passkeyToken: z.string({ error: "Informe o token do desafio." }),
  resposta: z.record(z.string(), z.unknown()),
});

export const esquemaSuspensao = z.object({
  // Ausente = suspensão permanente. Presente = suspensão por N dias a partir
  // de agora (calculado no servidor, não no cliente).
  dias: z.number().int().positive().max(3650, { error: "Prazo muito longo." }).optional(),
  motivo: z.string().trim().max(280, { error: "Motivo muito longo." }).optional(),
});

export const esquemaCriarOrganizacao = z.object({
  nome: z
    .string({ error: "Informe o nome da organização." })
    .trim()
    .min(2, { error: "O nome deve ter pelo menos 2 caracteres." })
    .max(80, { error: "O nome é longo demais (máximo de 80 caracteres)." }),
});

export const esquemaCriarConvite = z.object({
  email: z.email({ error: "Informe um e-mail válido." }).trim().toLowerCase(),
  // "dono" fica de fora de propósito — convidar alguém já como dono
  // equivaleria a uma transferência de titularidade, que merece um fluxo
  // próprio (confirmação explícita de quem está saindo do posto), não um
  // convite comum.
  papel: z.enum(["admin", "membro"], { error: "Papel inválido para convite." }),
});

export const esquemaAceitarConvite = z.object({
  token: z.string({ error: "Convite inválido." }).min(1, { error: "Convite inválido." }),
});
