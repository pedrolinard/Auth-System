export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

// Esqueleto no formato de um item de lista com card — usado enquanto
// projetos / sessões / passkeys / usuários carregam, no lugar do
// "Carregando..." em texto.
export function SkeletonLinha() {
  return (
    <div className="card-surface flex items-center justify-between gap-3 p-4">
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <Skeleton className="h-7 w-16 rounded-full" />
    </div>
  );
}

export function SkeletonLista({ linhas = 3 }: { linhas?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: linhas }, (_, i) => (
        <SkeletonLinha key={i} />
      ))}
    </div>
  );
}
