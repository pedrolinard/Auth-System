import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TextoJuridico } from "@/components/TextoJuridico";
import { lerDocumentoPublicado } from "@/lib/documentosJuridicos";

// Estática: o texto é lido no build. 404 até existir o texto revisado em
// src/conteudo/juridico/termos-de-uso.md (ver src/lib/documentosJuridicos.ts).
export const dynamic = "force-static";

export const metadata: Metadata = { title: "Termos de Uso — Auth Gateway" };

export default function Pagina() {
  const blocos = lerDocumentoPublicado("termos-de-uso");
  if (!blocos) notFound();
  return <TextoJuridico blocos={blocos} />;
}
