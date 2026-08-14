import type { Metadata } from "next";
import Link from "next/link";
import {
  atualizadoEm,
  concluido,
  proximosPassos,
  type PrioridadeRoadmap,
} from "@/data/roadmap";

export const metadata: Metadata = {
  title: "Roadmap — Sistema de Autenticação",
  description:
    "O que já foi entregue e o que ainda falta no gateway de autenticação.",
};

const ROTULO_PRIORIDADE: Record<PrioridadeRoadmap, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

// Mesmo idioma visual dos badges de src/app/dashboard/usuarios/page.tsx
// (rounded-full + tinta translúcida colorida), só trocando a cor por
// prioridade — mantém o roadmap visualmente parte do mesmo app, não uma
// página à parte com CSS próprio (era o caso do antigo public/roadmap.html).
const COR_PRIORIDADE: Record<PrioridadeRoadmap, string> = {
  alta: "border-red-600/30 bg-red-600/10 text-red-600 dark:text-red-400",
  media: "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  baixa: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

const totalConcluido = concluido.reduce((soma, grupo) => soma + grupo.itens.length, 0);
const totalPendente = proximosPassos.filter((item) => item.status === "pendente").length;
const totalFeitoProximosPassos = proximosPassos.length - totalPendente;

export default function PaginaRoadmap() {
  const pendentesPorPrioridade = (["alta", "media", "baixa"] as const).map(
    (prioridade) => ({
      prioridade,
      itens: proximosPassos.filter((item) => item.prioridade === prioridade),
    }),
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3 border-b border-black/[.08] pb-8 dark:border-white/[.1]">
        <span className="eyebrow text-zinc-500 dark:text-zinc-500">Roadmap · Auth Gateway</span>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Sistema de Autenticação
        </h1>
        <p className="max-w-2xl text-zinc-600 dark:text-zinc-400">
          Gateway de cadastro, login e emissão de tokens JWT (acesso +
          atualização) para outras aplicações, com um serviço de domínio em
          Django/DRF por trás. Estado atual do que foi entregue e do que vem a
          seguir.
        </p>
        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-500">
          atualizado em {atualizadoEm} · gerado a partir de{" "}
          <code>src/data/roadmap.ts</code>
        </span>
      </header>

      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-black/[.08] bg-black/[.08] dark:border-white/[.1] dark:bg-white/[.1]">
        <div className="flex flex-col gap-1 bg-white p-5 dark:bg-zinc-900">
          <span className="font-mono text-2xl tabular-nums text-foreground">
            {totalConcluido}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-500">itens entregues</span>
        </div>
        <div className="flex flex-col gap-1 bg-white p-5 dark:bg-zinc-900">
          <span className="font-mono text-2xl tabular-nums text-foreground">
            {totalPendente}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-500">próximos passos pendentes</span>
        </div>
        <div className="flex flex-col gap-1 bg-white p-5 dark:bg-zinc-900">
          <span className="font-mono text-2xl tabular-nums text-foreground">
            {totalFeitoProximosPassos}/{proximosPassos.length}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-500">próximos passos concluídos</span>
        </div>
      </div>

      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="eyebrow shrink-0 text-zinc-500 dark:text-zinc-500">Próximos passos</span>
          <span className="h-px flex-1 bg-black/[.08] dark:bg-white/[.1]" />
        </div>

        <div className="flex flex-col gap-3">
          {pendentesPorPrioridade.map(
            ({ prioridade, itens }) =>
              itens.length > 0 && (
                <div key={prioridade} className="flex flex-col gap-2.5">
                  <h2 className="font-mono text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                    Prioridade {ROTULO_PRIORIDADE[prioridade].toLowerCase()}
                  </h2>
                  <ul className="flex flex-col gap-2.5">
                    {itens.map((item) => (
                      <li
                        key={item.id}
                        className="card-surface flex flex-col gap-1.5 p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${COR_PRIORIDADE[item.prioridade]}`}
                          >
                            {ROTULO_PRIORIDADE[item.prioridade]}
                          </span>
                          <h3 className="text-sm font-medium text-foreground">{item.titulo}</h3>
                          <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
                            {item.categoria}
                          </span>
                          {item.status === "feito" && (
                            <span className="whitespace-nowrap rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-black dark:bg-white/10 dark:text-white">
                              ✓ Feito{item.concluidoEm ? ` em ${item.concluidoEm}` : ""}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">{item.descricao}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ),
          )}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="eyebrow shrink-0 text-zinc-500 dark:text-zinc-500">Concluído</span>
          <span className="h-px flex-1 bg-black/[.08] dark:bg-white/[.1]" />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {concluido.map((grupo) => (
            <div key={grupo.categoria} className="card-surface flex flex-col gap-2.5 p-4">
              <h3 className="font-mono text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                {grupo.categoria}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {grupo.itens.map((texto) => (
                  <li
                    key={texto}
                    className="relative pl-4 text-sm text-zinc-600 before:absolute before:left-0 before:top-[0.6em] before:h-1 before:w-1 before:rotate-45 before:bg-zinc-400 dark:text-zinc-400 dark:before:bg-zinc-600"
                  >
                    {texto}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <footer className="flex flex-col gap-2 border-t border-black/[.08] pt-6 font-mono text-xs text-zinc-500 dark:border-white/[.1] dark:text-zinc-500">
        <span>
          Este roadmap é renderizado ao vivo a partir de{" "}
          <code>src/data/roadmap.ts</code> — cada item de &ldquo;Próximos
          passos&rdquo; é marcado como feito no mesmo commit que entrega a
          mudança, então esta página reflete o deploy mais recente
          automaticamente.
        </span>
        <Link href="/" className="text-zinc-600 underline underline-offset-2 dark:text-zinc-400">
          ← Voltar
        </Link>
      </footer>
    </div>
  );
}
