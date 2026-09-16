import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TextoJuridico } from "@/components/TextoJuridico";
import { lerDocumentoPublicado } from "@/lib/documentosJuridicos";

// Estática: o texto é lido no build. 404 até existir o texto revisado em
// src/conteudo/juridico/politica-de-privacidade.md (ver src/lib/documentosJuridicos.ts).
export const dynamic = "force-static";

export const metadata: Metadata = { title: "Política de Privacidade — Auth Gateway" };

export default function Pagina() {
  const blocos = lerDocumentoPublicado("politica-de-privacidade");
  if (!blocos) notFound();
  return <TextoJuridico blocos={blocos} />;
}
