import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

// Política de privacidade e termos de uso publicados no próprio site.
//
// O texto que vai ao ar fica em src/conteudo/juridico/<documento>.md e só é
// escrito lá DEPOIS da revisão jurídica (os rascunhos ficam em docs/juridico/).
// Enquanto o arquivo não existir, ou ainda tiver marca de rascunho, a página
// responde 404 e o cadastro não mostra o link: não dá pra publicar sem querer
// um texto com "[CNPJ]" ou "[CONFIRMAR ...]" no meio.
//
// Lido no build (as páginas são estáticas): trocar o texto exige um deploy.

export type DocumentoJuridico = "politica-de-privacidade" | "termos-de-uso";

export type Bloco =
  | { tipo: "titulo"; nivel: 1 | 2 | 3; texto: string }
  | { tipo: "paragrafo"; texto: string }
  | { tipo: "lista"; itens: string[] };

// Marcadores dos rascunhos: [RAZÃO SOCIAL], [CONFIRMAR se ...], [DEFINIR ...].
const MARCADOR = /\[[A-ZÀ-Ý][A-ZÀ-Ý0-9 ./-]{2,}/;

/** Motivo pelo qual o texto ainda não pode ir ao ar, ou null se pode. */
export function pendenciaDePublicacao(texto: string): string | null {
  if (/rascunho/i.test(texto)) return "o texto ainda se identifica como rascunho";
  const marcador = texto.match(MARCADOR);
  if (marcador) return `marcador não preenchido: ${marcador[0]}]`;
  return null;
}

export function lerDocumentoPublicado(documento: DocumentoJuridico): Bloco[] | null {
  let texto: string;
  try {
    texto = readFileSync(path.join(process.cwd(), "src/conteudo/juridico", `${documento}.md`), "utf8");
  } catch {
    return null;
  }
  const pendencia = pendenciaDePublicacao(texto);
  if (pendencia) {
    console.warn(`[juridico] ${documento}.md não publicado: ${pendencia}.`);
    return null;
  }
  return interpretarMarkdown(texto);
}

/**
 * Subconjunto de Markdown suficiente pra um texto jurídico: títulos (#, ##,
 * ###), parágrafos e listas com "- ". Negrito é tratado na renderização.
 */
export function interpretarMarkdown(texto: string): Bloco[] {
  const blocos: Bloco[] = [];
  let paragrafo: string[] = [];
  let lista: string[] | null = null;

  const fecharParagrafo = () => {
    if (paragrafo.length) blocos.push({ tipo: "paragrafo", texto: paragrafo.join(" ") });
    paragrafo = [];
  };
  const fecharLista = () => {
    if (lista?.length) blocos.push({ tipo: "lista", itens: lista });
    lista = null;
  };

  for (const bruta of texto.replace(/\r\n/g, "\n").split("\n")) {
    const linha = bruta.trim();
    const titulo = linha.match(/^(#{1,3})\s+(.*)$/);
    if (!linha) {
      fecharParagrafo();
      fecharLista();
    } else if (titulo) {
      fecharParagrafo();
      fecharLista();
      blocos.push({ tipo: "titulo", nivel: titulo[1].length as 1 | 2 | 3, texto: titulo[2] });
    } else if (linha.startsWith("- ")) {
      fecharParagrafo();
      lista ??= [];
      lista.push(linha.slice(2));
    } else if (lista && bruta.startsWith("  ")) {
      // Continuação do item anterior, quebrada em várias linhas.
      lista[lista.length - 1] += ` ${linha}`;
    } else {
      fecharLista();
      paragrafo.push(linha);
    }
  }
  fecharParagrafo();
  fecharLista();
  return blocos;
}

export function documentosPublicados(): { privacidade: boolean; termos: boolean } {
  return {
    privacidade: lerDocumentoPublicado("politica-de-privacidade") !== null,
    termos: lerDocumentoPublicado("termos-de-uso") !== null,
  };
}
