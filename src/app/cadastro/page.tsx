import { documentosPublicados } from "@/lib/documentosJuridicos";

import { FormularioCadastro } from "./FormularioCadastro";

// Estática como antes; a única coisa lida no servidor é se já existem termos
// e política publicados, pra mostrar (ou não) o aviso com os links.
export const dynamic = "force-static";

export default function PaginaCadastro() {
  return <FormularioCadastro documentos={documentosPublicados()} />;
}
