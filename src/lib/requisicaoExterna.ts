import "server-only";

import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

// POST pra uma URL escolhida por um CLIENTE do provedor (webhooks). Sem
// cuidado, isso é SSRF: um cliente cadastra http://169.254.169.254/ (metadados
// da nuvem), http://localhost:5432 ou o IP interno de outro serviço e usa o
// provedor pra alcançar a rede de dentro.
//
// - Só https. http e endereço de rede local só com WEBHOOKS_PERMITIR_REDE_LOCAL=1
//   (testes e dev; nunca em produção).
// - O host é resolvido ANTES e todo endereço devolvido é conferido contra as
//   faixas privadas/reservadas. A conexão usa o endereço já validado (lookup
//   fixo): um DNS que responde público na checagem e privado na conexão
//   (rebinding) não passa.
// - Sem seguir redirecionamento (um 302 pra rede interna seria o desvio óbvio)
//   e com teto de tempo e de tamanho da resposta.

const BLOQUEADOS = new BlockList();
for (const [rede, prefixo] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  BLOQUEADOS.addSubnet(rede, prefixo, "ipv4");
}
for (const [rede, prefixo] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32], ["64:ff9b::", 96],
] as const) {
  BLOQUEADOS.addSubnet(rede, prefixo, "ipv6");
}

export function enderecoBloqueado(endereco: string): boolean {
  const familia = isIP(endereco);
  if (familia === 0) return true;
  // IPv4 mapeado em IPv6 (::ffff:10.0.0.1) é o IPv4 de dentro.
  const mapeado = endereco.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapeado) return BLOQUEADOS.check(mapeado[1], "ipv4");
  return BLOQUEADOS.check(endereco, familia === 4 ? "ipv4" : "ipv6");
}

function redeLocalPermitida(): boolean {
  return process.env.WEBHOOKS_PERMITIR_REDE_LOCAL === "1" && process.env.NODE_ENV !== "production";
}

/** Valida o formato da URL de destino (usado também no cadastro do webhook). */
export function urlDeDestinoAceitavel(valor: string): boolean {
  try {
    const url = new URL(valor);
    if (url.username || url.password) return false;
    if (redeLocalPermitida()) return url.protocol === "https:" || url.protocol === "http:";
    // Só a porta padrão do https: porta explícita é o jeito de mirar um
    // serviço interno exposto num IP público (Redis, painel de admin...).
    return url.protocol === "https:" && (url.port === "" || url.port === "443");
  } catch {
    return false;
  }
}

export type ResultadoPost = { ok: boolean; status: number | null; erro: string | null };

export async function postarParaUrlExterna(
  destino: string,
  corpo: string,
  cabecalhos: Record<string, string>,
  tempoLimiteMs = 10_000,
): Promise<ResultadoPost> {
  if (!urlDeDestinoAceitavel(destino)) return { ok: false, status: null, erro: "URL de destino não permitida." };
  const url = new URL(destino);
  const host = url.hostname.replace(/^\[|\]$/g, "");

  let enderecos: { address: string; family: number }[];
  try {
    enderecos = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  } catch {
    return { ok: false, status: null, erro: "Não foi possível resolver o endereço." };
  }
  if (enderecos.length === 0) return { ok: false, status: null, erro: "Não foi possível resolver o endereço." };
  if (!redeLocalPermitida() && enderecos.some((e) => enderecoBloqueado(e.address))) {
    return { ok: false, status: null, erro: "O endereço aponta pra uma rede interna ou reservada." };
  }
  const escolhido = enderecos[0];

  // Conecta no endereço JÁ validado, qualquer que seja a resposta de um novo
  // DNS neste instante.
  const lookupFixo: LookupFunction = (_nome, opcoes, callback) => {
    if (opcoes && typeof opcoes === "object" && "all" in opcoes && opcoes.all) {
      callback(null, [{ address: escolhido.address, family: escolhido.family }]);
    } else {
      callback(null, escolhido.address, escolhido.family);
    }
  };

  const modulo = url.protocol === "https:" ? https : http;
  return new Promise<ResultadoPost>((resolve) => {
    const requisicao = modulo.request(
      url,
      {
        method: "POST",
        headers: { ...cabecalhos, "Content-Length": Buffer.byteLength(corpo).toString() },
        lookup: lookupFixo,
        timeout: tempoLimiteMs,
      },
      (resposta) => {
        let lidos = 0;
        resposta.on("data", (pedaco: Buffer) => {
          lidos += pedaco.length;
          if (lidos > 64 * 1024) resposta.destroy();
        });
        const status = resposta.statusCode ?? null;
        const concluir = () =>
          resolve({ ok: status !== null && status >= 200 && status < 300, status, erro: null });
        resposta.on("end", concluir);
        resposta.on("close", concluir);
        resposta.on("error", concluir);
      },
    );
    requisicao.on("timeout", () => {
      requisicao.destroy();
      resolve({ ok: false, status: null, erro: "Tempo esgotado." });
    });
    requisicao.on("error", (erro) => resolve({ ok: false, status: null, erro: erro.message.slice(0, 200) }));
    requisicao.end(corpo);
  });
}
