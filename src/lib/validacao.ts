import * as z from "zod";

export const esquemaCadastro = z.object({
  nome: z
    .string({ error: "Informe o nome." })
    .trim()
    .min(2, { error: "O nome deve ter pelo menos 2 caracteres." }),
  email: z
    .email({ error: "Informe um e-mail válido." })
    .trim()
    .toLowerCase(),
  senha: z
    .string({ error: "Informe a senha." })
    .min(8, { error: "A senha deve ter pelo menos 8 caracteres." })
    .regex(/[a-zA-Z]/, { error: "A senha deve conter pelo menos uma letra." })
    .regex(/[0-9]/, { error: "A senha deve conter pelo menos um número." }),
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
