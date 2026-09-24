import { describe, expect, it } from "vitest";
import { mascararEmails } from "@/lib/rollbarServidor";

describe("Mascaramento de e-mail no Rollbar do servidor (src/lib/rollbarServidor.ts)", () => {
  it("troca e-mails dentro de textos em qualquer profundidade do relatório", () => {
    const relatorio = {
      body: {
        trace: {
          exception: { message: "Falha ao enviar pra fulano.silva+x@empresa.com.br" },
          frames: [{ filename: "/var/task/.next/server/app/api/auth/login/route.js", lineno: 10 }],
        },
      },
      custom: { alerta: "dispositivo novo", destinos: ["a@b.io", "sem e-mail aqui"] },
    };

    mascararEmails(relatorio);

    expect(relatorio.body.trace.exception.message).toBe("Falha ao enviar pra [email]");
    expect(relatorio.custom.destinos).toEqual(["[email]", "sem e-mail aqui"]);
  });

  it("não mexe no que só parece e-mail: caminhos, pacotes com versão, códigos de erro", () => {
    const relatorio = {
      frames: [
        { filename: "/var/task/node_modules/@prisma/adapter-pg/dist/index.js" },
        { filename: "/var/task/node_modules/.pnpm/next@16.3.4/node_modules/next/dist/server.js" },
      ],
      code: "P2002",
      lineno: 42,
      ativo: true,
      vazio: null,
    };
    const copia = structuredClone(relatorio);

    mascararEmails(relatorio);

    expect(relatorio).toEqual(copia);
  });
});
