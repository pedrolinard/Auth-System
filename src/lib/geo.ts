import "server-only";

// Geolocalização por IP sem serviço externo: a Vercel já resolve o IP da
// requisição e injeta o resultado nestes headers antes de chegar na função
// (https://vercel.com/docs/edge-network/headers#x-vercel-ip-city). Fora da
// Vercel (dev local, outro host) os headers simplesmente não existem — os
// campos ficam null, tratado como "localização desconhecida" pelo chamador.
export type Geo = {
  cidade: string | null;
  regiao: string | null;
  pais: string | null;
};

export function obterGeo(req: Request): Geo {
  const cidadeBruta = req.headers.get("x-vercel-ip-city");
  const regiao = req.headers.get("x-vercel-ip-country-region");
  const pais = req.headers.get("x-vercel-ip-country");

  let cidade: string | null = null;
  if (cidadeBruta) {
    try {
      cidade = decodeURIComponent(cidadeBruta);
    } catch {
      cidade = cidadeBruta;
    }
  }

  return { cidade, regiao, pais };
}

// Nome completo do país (em português) a partir do código ISO 3166-1 alpha-2
// que a Vercel manda — usa o Intl nativo do runtime, sem precisar de uma
// tabela própria nem de dependência.
function nomePais(codigo: string): string {
  try {
    return new Intl.DisplayNames(["pt-BR"], { type: "region" }).of(codigo) ?? codigo;
  } catch {
    return codigo;
  }
}

// Monta "Cidade, UF, País" a partir do que estiver disponível, omitindo
// pedaços ausentes — nunca deixa vírgulas soltas nem "null" no texto.
export function formatarLocalizacao(geo: Geo): string | null {
  const partes = [geo.cidade, geo.regiao, geo.pais ? nomePais(geo.pais) : null].filter(
    (parte): parte is string => Boolean(parte),
  );
  return partes.length > 0 ? partes.join(", ") : null;
}
