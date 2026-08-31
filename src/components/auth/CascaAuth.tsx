import Link from "next/link";
import { Marca } from "@/components/Marca";

// Casca comum das telas de entrada (login, cadastro, recuperação, verificação).
// Centraliza o card, a marca, o eyebrow e o título — antes cada página repetia
// o mesmo bloco de 8 linhas, o que dava aquela cara de "gerado em série".
export function CascaAuth({
  titulo,
  descricao,
  children,
  rodape,
  centralizado = false,
}: {
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
  rodape?: React.ReactNode;
  centralizado?: boolean;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div
        className={`card-surface animate-surgir flex w-full max-w-sm flex-col gap-5 p-8 ${
          centralizado ? "items-center text-center" : ""
        }`}
      >
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-xl border border-black/[.08] bg-black/[.02] dark:border-white/[.1] dark:bg-white/[.03] ${
            centralizado ? "" : "-ml-0.5"
          }`}
        >
          <Marca className="h-5 w-5 text-foreground" />
        </div>

        <div className={`flex flex-col gap-1.5 ${centralizado ? "items-center" : ""}`}>
          <span className="eyebrow text-zinc-500 dark:text-zinc-500">Auth Gateway</span>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{titulo}</h1>
          {descricao && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{descricao}</p>
          )}
        </div>

        {children}

        {rodape && (
          <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">{rodape}</p>
        )}
      </div>
    </div>
  );
}

export function LinkAuth({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="link-underline font-medium text-foreground">
      {children}
    </Link>
  );
}
