import type { LucideIcon } from "lucide-react";

// Cabeçalho padrão de seção: chip com ícone + eyebrow + título (+ descrição
// e ação opcionais). Substitui o par "<span eyebrow>/<h2>" repetido em cada
// card, agora com um ponto de fixação visual à esquerda.
export function CabecalhoSecao({
  icone: Icone,
  eyebrow,
  titulo,
  descricao,
  acao,
}: {
  icone: LucideIcon;
  eyebrow: string;
  titulo: string;
  descricao?: string;
  acao?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="chip-secao">
        <Icone className="h-4 w-4" strokeWidth={2} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="eyebrow text-zinc-500 dark:text-zinc-500">{eyebrow}</span>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{titulo}</h2>
        {descricao && (
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{descricao}</p>
        )}
      </div>
      {acao && <div className="shrink-0">{acao}</div>}
    </div>
  );
}
