import { Skeleton, SkeletonLista } from "@/components/ui/Skeleton";

// Toda página renderiza por requisição (o nonce da CSP exige, ver
// src/app/layout.tsx), então entre o clique no menu e a resposta do servidor
// havia um intervalo sem nenhum retorno visual. O menu (layout) continua na
// tela; só o conteúdo vira esqueleto, no mesmo formato das páginas.
export default function CarregandoDashboard() {
  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-6 py-10" aria-busy="true">
      <div className="flex w-full min-w-0 max-w-lg flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <SkeletonLista linhas={3} />
      </div>
    </div>
  );
}
