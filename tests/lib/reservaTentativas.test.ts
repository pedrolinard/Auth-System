import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { reservarTentativas } from "@/lib/rateLimit";

// Chaves próprias de cada teste (evento com sufixo aleatório), apagadas no fim.
const eventos: string[] = [];
function eventoNovo(): string {
  const evento = `teste_reserva_${randomUUID()}`;
  eventos.push(evento);
  return evento;
}

afterAll(async () => {
  for (const evento of eventos) {
    await prisma.limiteTaxa.deleteMany({ where: { chave: { contains: evento } } });
  }
});

describe("reservarTentativas (src/lib/rateLimit.ts)", () => {
  it("sob pedidos simultâneos, só passam exatamente `maximo` reservas", async () => {
    const evento = eventoNovo();
    const limite = { ip: "203.0.113.10", evento, maximo: 5, janelaMs: 60_000 };

    const reservas = await Promise.all(Array.from({ length: 40 }, () => reservarTentativas([limite])));

    expect(reservas.filter(Boolean)).toHaveLength(5);
    // As recusadas desfazem o próprio incremento: o contador fica no limite.
    const linha = await prisma.limiteTaxa.findUniqueOrThrow({ where: { chave: `ip:${evento}:203.0.113.10` } });
    expect(linha.contagem).toBe(5);
  });

  it("liberar() devolve a vaga: acertos não gastam o orçamento", async () => {
    const evento = eventoNovo();
    const limite = { aplicacaoId: "app-teste", email: "a@exemplo.com", evento, maximo: 2, janelaMs: 60_000 };

    for (let i = 0; i < 10; i++) {
      const reserva = await reservarTentativas([limite]);
      expect(reserva).not.toBeNull();
      await reserva!.liberar();
    }
    // Duas falhas (reservas mantidas) esgotam; a terceira é recusada.
    expect(await reservarTentativas([limite])).not.toBeNull();
    expect(await reservarTentativas([limite])).not.toBeNull();
    expect(await reservarTentativas([limite])).toBeNull();
  });

  it("recusa em um limite desfaz a reserva feita no outro", async () => {
    const evento = eventoNovo();
    const porIp = { ip: "203.0.113.11", evento, maximo: 10, janelaMs: 60_000 };
    const porConta = { aplicacaoId: "app-teste", email: "b@exemplo.com", evento, maximo: 1, janelaMs: 60_000 };

    expect(await reservarTentativas([porIp, porConta])).not.toBeNull();
    expect(await reservarTentativas([porIp, porConta])).toBeNull();

    const linhaIp = await prisma.limiteTaxa.findUniqueOrThrow({ where: { chave: `ip:${evento}:203.0.113.11` } });
    expect(linhaIp.contagem).toBe(1);
  });

  it("sem IP, o limite por IP é ignorado (não bloqueia todo mundo)", async () => {
    const evento = eventoNovo();
    const reserva = await reservarTentativas([{ ip: null, evento, maximo: 0, janelaMs: 60_000 }]);
    expect(reserva).not.toBeNull();
  });
});
