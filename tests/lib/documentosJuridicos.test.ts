import { describe, expect, it } from "vitest";
import { interpretarMarkdown, lerDocumentoPublicado, pendenciaDePublicacao } from "@/lib/documentosJuridicos";

describe("Textos jurídicos publicados (src/lib/documentosJuridicos.ts)", () => {
  it("recusa publicar rascunho ou texto com marcador não preenchido", () => {
    expect(pendenciaDePublicacao("# Política\n\n> RASCUNHO — revisar")).toContain("rascunho");
    expect(pendenciaDePublicacao("Operado por [RAZÃO SOCIAL], CNPJ 00.000.000/0001-00.")).toContain("[RAZÃO SOCIAL]");
    expect(pendenciaDePublicacao("[CONFIRMAR se algum fornecedor ...]")).toContain("[CONFIRMAR");
    expect(pendenciaDePublicacao("Encarregado: [E-MAIL DO ENCARREGADO]")).toContain("[E-MAIL DO ENCARREGADO]");
  });

  it("aceita o texto final, inclusive com colchetes que não são marcador", () => {
    expect(pendenciaDePublicacao("# Política\n\nOperado por Empresa X Ltda. Veja o item [1] e o art. 18.")).toBeNull();
  });

  it("nenhum rascunho de docs/juridico passa na checagem", async () => {
    const { readFileSync } = await import("node:fs");
    for (const nome of ["politica-de-privacidade", "termos-de-uso"]) {
      const rascunho = readFileSync(`docs/juridico/${nome}.md`, "utf8");
      expect(pendenciaDePublicacao(rascunho), nome).not.toBeNull();
    }
  });

  it("sem o texto final em src/conteudo/juridico, nada é publicado", () => {
    expect(lerDocumentoPublicado("politica-de-privacidade")).toBeNull();
    expect(lerDocumentoPublicado("termos-de-uso")).toBeNull();
  });

  it("interpreta títulos, parágrafos em várias linhas e listas com continuação", () => {
    const blocos = interpretarMarkdown(
      "# Título\r\n\r\nPrimeira linha\r\ncontinua aqui.\r\n\r\n## Seção\r\n- **Item** um\r\n  que quebra\r\n- dois\r\nDepois da lista.",
    );
    expect(blocos).toEqual([
      { tipo: "titulo", nivel: 1, texto: "Título" },
      { tipo: "paragrafo", texto: "Primeira linha continua aqui." },
      { tipo: "titulo", nivel: 2, texto: "Seção" },
      { tipo: "lista", itens: ["**Item** um que quebra", "dois"] },
      { tipo: "paragrafo", texto: "Depois da lista." },
    ]);
  });
});
