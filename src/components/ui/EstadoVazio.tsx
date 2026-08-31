import type { LucideIcon } from "lucide-react";

// Estado vazio com personalidade — um ícone contornado, um título curto e
// uma linha que fala com a pessoa ("Crie o primeiro e ele aparece aqui.")
// em vez do "Nenhum projeto ainda." seco.
export function EstadoVazio({
  icone: Icone,
  titulo,
  descricao,
  acao,
}: {
  icone: LucideIcon;
  titulo: string;
  descricao: string;
  acao?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-black/[.12] px-6 py-10 text-center dark:border-white/[.14]">
      <div className="chip-secao h-11 w-11 rounded-2xl">
        <Icone className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{titulo}</p>
        <p className="mx-auto max-w-xs text-sm text-zinc-500 dark:text-zinc-400">{descricao}</p>
      </div>
      {acao}
    </div>
  );
}
