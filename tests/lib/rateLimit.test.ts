import { describe, expect, it } from "vitest";
import { obterIp } from "@/lib/rateLimit";

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/auth/login", { headers });
}

describe("Extração de IP para rate limit (src/lib/rateLimit.ts)", () => {
  it("prefere x-vercel-forwarded-for (a Vercel controla, cliente não forja)", () => {
    const ip = obterIp(
      req({
        "x-vercel-forwarded-for": "203.0.113.7",
        // Valor plantado pelo cliente no XFF — deve ser ignorado.
        "x-forwarded-for": "1.2.3.4, 203.0.113.7",
        "x-real-ip": "203.0.113.7",
      }),
    );
    expect(ip).toBe("203.0.113.7");
  });

  it("cai pra x-real-ip quando não há x-vercel-forwarded-for", () => {
    const ip = obterIp(
      req({ "x-real-ip": "198.51.100.9", "x-forwarded-for": "9.9.9.9, 198.51.100.9" }),
    );
    expect(ip).toBe("198.51.100.9");
  });

  it("usa o item à esquerda do x-forwarded-for só como último recurso (dev / proxy não-Vercel)", () => {
    const ip = obterIp(req({ "x-forwarded-for": "192.0.2.44, 10.0.0.1" }));
    expect(ip).toBe("192.0.2.44");
  });

  it("sem nenhum header de IP, retorna null (não bloqueia todo mundo por engano)", () => {
    expect(obterIp(req({}))).toBeNull();
  });

  it("header de IP em branco não conta como valor (cai pro próximo)", () => {
    const ip = obterIp(req({ "x-vercel-forwarded-for": "   ", "x-real-ip": "203.0.113.50" }));
    expect(ip).toBe("203.0.113.50");
  });
});
