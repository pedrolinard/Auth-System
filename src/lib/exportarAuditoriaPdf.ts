"use client";

import type { RegistroAuditoria } from "@/lib/clienteAuth";

// jsPDF + autotable são pesados (~400 KB juntos) e só servem aqui — carrega
// sob demanda no clique do botão, fora do bundle principal. A auditoria já
// vem carregada no estado da página (até 200 registros), então isto é só
// formatação: nenhuma chamada de rede a mais.
export async function exportarAuditoriaPdf(
  registros: RegistroAuditoria[],
  filtros: { evento?: string; email?: string } = {},
) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableMod.default;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const geradoEm = new Date().toLocaleString("pt-BR");

  doc.setFontSize(14);
  doc.text("Auditoria — Auth Gateway", 40, 40);

  doc.setFontSize(9);
  doc.setTextColor(110);
  const filtrosAtivos = [
    filtros.evento ? `evento: ${filtros.evento}` : null,
    filtros.email ? `e-mail: ${filtros.email}` : null,
  ].filter(Boolean);
  const legenda = [
    `${registros.length} registro(s)`,
    filtrosAtivos.length ? `filtro — ${filtrosAtivos.join(" · ")}` : "sem filtro",
    `gerado em ${geradoEm}`,
  ].join("   |   ");
  doc.text(legenda, 40, 56);

  autoTable(doc, {
    startY: 70,
    head: [["Quando", "Evento", "E-mail", "Admin responsável", "IP", "User-Agent"]],
    body: registros.map((r) => [
      new Date(r.criadoEm).toLocaleString("pt-BR"),
      r.evento,
      r.email ?? "—",
      r.autorEmail ?? "—",
      r.ip ?? "—",
      r.userAgent ?? "—",
    ]),
    styles: { fontSize: 7, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: [24, 24, 27], fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 90 },
      1: { cellWidth: 110, font: "courier" },
      2: { cellWidth: 130 },
      3: { cellWidth: 130 },
      4: { cellWidth: 80 },
      5: { cellWidth: "auto" },
    },
    didDrawPage: (dados) => {
      const total = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(
        `Página ${dados.pageNumber} de ${total}`,
        doc.internal.pageSize.getWidth() - 90,
        doc.internal.pageSize.getHeight() - 20,
      );
    },
  });

  const carimbo = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  doc.save(`auditoria-${carimbo}.pdf`);
}
