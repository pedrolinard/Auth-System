import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { enderecoBloqueado, postarParaUrlExterna, urlDeDestinoAceitavel } from "@/lib/requisicaoExterna";

// O processo do Vitest NÃO tem WEBHOOKS_PERMITIR_REDE_LOCAL (só o servidor de
// teste tem), então aqui vale a regra de produção.

describe("POST pra URL de cliente sem SSRF (src/lib/requisicaoExterna.ts)", () => {
  it("bloqueia rede interna, metadados da nuvem, loopback e IPv4 mapeado em IPv6", () => {
    for (const endereco of [
      "10.0.0.1", "172.16.5.4", "192.168.1.1", "127.0.0.1", "0.0.0.0", "100.64.0.1",
      "169.254.169.254", "224.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:10.0.0.1",
      "::ffff:169.254.169.254", "::ffff:127.0.0.1",
    ]) {
      expect(enderecoBloqueado(endereco), endereco).toBe(true);
    }
    for (const endereco of ["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888"]) {
      expect(enderecoBloqueado(endereco), endereco).toBe(false);
    }
  });

  it("aceita só https na porta padrão, sem credencial na URL", () => {
    expect(urlDeDestinoAceitavel("https://cliente.example/hook")).toBe(true);
    expect(urlDeDestinoAceitavel("https://cliente.example:443/hook")).toBe(true);
    expect(urlDeDestinoAceitavel("https://cliente.example:6379/hook")).toBe(false);
    expect(urlDeDestinoAceitavel("http://cliente.example/hook")).toBe(false);
    expect(urlDeDestinoAceitavel("https://usuario:senha@cliente.example/hook")).toBe(false);
    expect(urlDeDestinoAceitavel("ftp://cliente.example/hook")).toBe(false);
  });

  it("não envia pra IP interno nem pra host que resolve pra loopback", async () => {
    const direto = await postarParaUrlExterna("https://127.0.0.1/hook", "{}", {});
    expect(direto.ok).toBe(false);
    expect(direto.erro).toContain("rede interna");

    const porNome = await postarParaUrlExterna("https://localhost/hook", "{}", {});
    expect(porNome.ok).toBe(false);
    expect(porNome.erro).toContain("rede interna");
  });

  it("prazo é absoluto: destino que pinga 1 byte por vez não segura a conexão", async () => {
    const servidor = createServer((_req, res) => {
      res.writeHead(200);
      const gotejar = setInterval(() => res.write("."), 100);
      res.on("close", () => clearInterval(gotejar));
    });
    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    const porta = (servidor.address() as AddressInfo).port;
    process.env.WEBHOOKS_PERMITIR_REDE_LOCAL = "1";
    try {
      const inicio = Date.now();
      const resultado = await postarParaUrlExterna(`http://127.0.0.1:${porta}/hook`, "{}", {}, 700);
      expect(resultado).toMatchObject({ ok: false, erro: "Tempo esgotado." });
      expect(Date.now() - inicio).toBeLessThan(3000);
    } finally {
      delete process.env.WEBHOOKS_PERMITIR_REDE_LOCAL;
      servidor.closeAllConnections();
      await new Promise((resolve) => servidor.close(resolve));
    }
  });
});
