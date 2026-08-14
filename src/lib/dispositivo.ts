// Classificação leve de User-Agent em desktop/tablet/mobile — sem
// dependência externa (ua-parser-js etc.) porque só precisamos de uma
// categoria grosseira pra exibir na lista de sessões, não do fabricante,
// versão de OS ou engine exatos.
export type TipoDispositivo = "mobile" | "tablet" | "desktop" | "desconhecido";

export function classificarDispositivo(
  userAgent: string | null | undefined,
): TipoDispositivo {
  if (!userAgent) return "desconhecido";

  // iPad em iOS 13+ manda um UA de desktop por padrão, mas ainda expõe
  // suporte a touch — checamos isso antes da regra geral de tablet.
  if (/iPad/i.test(userAgent)) return "tablet";
  if (/Tablet|PlayBook|Nexus 7|Nexus 10/i.test(userAgent)) return "tablet";
  if (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent)) return "tablet";
  if (/Mobi|Android|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)) {
    return "mobile";
  }
  return "desktop";
}
