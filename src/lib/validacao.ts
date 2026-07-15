import * as z from "zod";

const esquemaSenhaForte = z
  .string({ error: "Informe a senha." })
  .min(8, { error: "A senha deve ter pelo menos 8 caracteres." })
  .regex(/[a-zA-Z]/, { error: "A senha deve conter pelo menos uma letra." })
  .regex(/[0-9]/, { error: "A senha deve conter pelo menos um número." });

export const esquemaCadastro = z.object({
  nome: z
    .string({ error: "Informe o nome." })
    .trim()
    .min(2, { error: "O nome deve ter pelo menos 2 caracteres." }),
  email: z
    .email({ error: "Informe um e-mail válido." })
    .trim()
    .toLowerCase(),
  senha: esquemaSenhaForte,
});

export const esquemaLogin = z.object({
  email: z.email({ error: "Informe um e-mail válido." }).trim().toLowerCase(),
  senha: z.string({ error: "Informe a senha." }).min(1, {
    error: "Informe a senha.",
  }),
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

export const esquemaSuspensao = z.object({
  // Ausente = suspensão permanente. Presente = suspensão por N dias a partir
  // de agora (calculado no servidor, não no cliente).
  dias: z.number().int().positive().max(3650, { error: "Prazo muito longo." }).optional(),
  motivo: z.string().trim().max(280, { error: "Motivo muito longo." }).optional(),
});
