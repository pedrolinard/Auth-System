import { Fragment } from "react";

import type { Bloco } from "@/lib/documentosJuridicos";

// **negrito** é a única marcação em linha que os textos jurídicos usam.
function comNegrito(texto: string) {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
    parte.startsWith("**") && parte.endsWith("**") ? (
      <strong key={i} className="font-semibold text-foreground">
        {parte.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{parte}</Fragment>
    ),
  );
}

export function TextoJuridico({ blocos }: { blocos: Bloco[] }) {
  return (
    <article className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-16 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
      {blocos.map((bloco, i) => {
        if (bloco.tipo === "titulo") {
          if (bloco.nivel === 1) {
            return (
              <h1 key={i} className="mb-2 text-2xl font-semibold tracking-tight text-foreground">
                {bloco.texto}
              </h1>
            );
          }
          const Tag = bloco.nivel === 2 ? "h2" : "h3";
          return (
            <Tag key={i} className="mt-4 text-base font-semibold text-foreground">
              {bloco.texto}
            </Tag>
          );
        }
        if (bloco.tipo === "lista") {
          return (
            <ul key={i} className="flex list-disc flex-col gap-1.5 pl-5">
              {bloco.itens.map((item, j) => (
                <li key={j}>{comNegrito(item)}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{comNegrito(bloco.texto)}</p>;
      })}
    </article>
  );
}
