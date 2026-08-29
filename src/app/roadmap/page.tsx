import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  atualizadoEm,
  concluido,
  metricas,
  proximosPassos,
  type PrioridadeRoadmap,
} from "@/data/roadmap";

// As métricas "ao vivo" (contagens do banco, commit do deploy) são lidas a
// cada requisição — sem cache, senão não seriam ao vivo. O resto da página
// continua vindo de src/data/roadmap.ts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Roadmap — Sistema de Autenticação",
  description:
    "O que já foi entregue, o que falta, e métricas ao vivo do gateway de autenticação.",
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
// "Resolvido" cobre tanto "feito" (virou código) quanto "descartado" (decisão
// consciente de não fazer) — os dois tiram o item da fila de pendências, só
// não da mesma forma, daí o rótulo do card não dizer "concluídos".
const totalResolvidoProximosPassos = proximosPassos.length - totalPendente;
const totalTestes = metricas.testesVitest + metricas.testesE2e + metricas.testesDjango;

type Uso =
  | { ok: true; usuarios: number; sessoesAtivas: number; passkeys: number; mfaAtivo: number; admins: number; eventos7d: number }
  | { ok: false };

// Contagens agregadas (nenhum dado pessoal) direto do Postgres de produção.
// Envolto em try/catch: um blip no banco mostra "—" em vez de derrubar a
// página inteira.
async function lerUso(): Promise<Uso> {
  try {
    const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [usuarios, sessoesAtivas, passkeys, mfaAtivo, admins, eventos7d] = await Promise.all([
      prisma.usuario.count(),
      prisma.tokenAtualizacao.count({
        where: { revogadoEm: null, expiraEm: { gt: new Date() } },
      }),
      prisma.passkeyCredencial.count(),
      prisma.usuario.count({ where: { mfaAtivado: true } }),
      prisma.usuario.count({ where: { papel: "admin" } }),
      prisma.logAuditoria.count({ where: { criadoEm: { gt: seteDiasAtras } } }),
    ]);
    return { ok: true, usuarios, sessoesAtivas, passkeys, mfaAtivo, admins, eventos7d };
  } catch {
    return { ok: false };
  }
}

function Stat({ valor, rotulo }: { valor: string | number; rotulo: string }) {
  return (
    <div className="flex flex-col gap-1 bg-white p-5 dark:bg-zinc-900">
      <span className="font-mono text-2xl tabular-nums text-foreground">{valor}</span>
      <span className="text-xs text-zinc-500 dark:text-zinc-500">{rotulo}</span>
    </div>
  );
}

export default async function PaginaRoadmap() {
  const uso = await lerUso();
  const agora = new Date();

  const deploy = {
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? "—",
    regiao: process.env.VERCEL_REGION ?? "—",
  };

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
          Django/DRF por trás. Estado atual do que foi entregue, o que falta e
          métricas ao vivo do sistema em produção.
        </p>
        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-500">
          atualizado em {atualizadoEm} · roadmap gerado a partir de{" "}
          <code>src/data/roadmap.ts</code>
        </span>
      </header>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-black/[.08] bg-black/[.08] sm:grid-cols-4 dark:border-white/[.1] dark:bg-white/[.1]">
        <Stat valor={totalConcluido} rotulo="itens entregues" />
        <Stat valor={totalPendente} rotulo="próximos passos pendentes" />
        <Stat
          valor={`${totalResolvidoProximosPassos}/${proximosPassos.length}`}
          rotulo="próximos passos resolvidos"
        />
        <Stat valor={totalTestes} rotulo="testes automatizados" />
      </div>

      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="eyebrow shrink-0 text-zinc-500 dark:text-zinc-500">Métricas ao vivo</span>
          <span className="h-px flex-1 bg-black/[.08] dark:bg-white/[.1]" />
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2.5">
            <h2 className="font-mono text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
              Uso · banco de produção {uso.ok ? "" : "(indisponível)"}
            </h2>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-black/[.08] bg-black/[.08] sm:grid-cols-3 dark:border-white/[.1] dark:bg-white/[.1]">
              <Stat valor={uso.ok ? uso.usuarios : "—"} rotulo="usuários cadastrados" />
              <Stat valor={uso.ok ? uso.sessoesAtivas : "—"} rotulo="sessões ativas agora" />
              <Stat valor={uso.ok ? uso.mfaAtivo : "—"} rotulo="contas com MFA" />
              <Stat valor={uso.ok ? uso.passkeys : "—"} rotulo="passkeys registradas" />
              <Stat valor={uso.ok ? uso.admins : "—"} rotulo="admins" />
              <Stat valor={uso.ok ? uso.eventos7d : "—"} rotulo="eventos de auditoria (7d)" />
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <h2 className="font-mono text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
              Código
            </h2>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-black/[.08] bg-black/[.08] sm:grid-cols-4 dark:border-white/[.1] dark:bg-white/[.1]">
              <Stat valor={metricas.rotasApi} rotulo="rotas de API" />
              <Stat valor={metricas.modulosLib} rotulo="módulos em src/lib" />
              <Stat valor={metricas.tabelas} rotulo="tabelas (Prisma)" />
              <Stat valor={metricas.migracoesPrisma} rotulo="migrações aplicadas" />
              <Stat valor={metricas.testesVitest} rotulo="testes Vitest" />
              <Stat valor={metricas.testesE2e} rotulo="testes E2E (Playwright)" />
              <Stat valor={metricas.testesDjango} rotulo="testes Django (pytest)" />
              <Stat valor={totalTestes} rotulo="testes no total" />
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <h2 className="font-mono text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
              Deploy
            </h2>
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-black/[.08] bg-black/[.08] sm:grid-cols-3 dark:border-white/[.1] dark:bg-white/[.1]">
              <Stat valor={deploy.commit} rotulo="commit em produção" />
              <Stat valor={deploy.branch} rotulo="branch" />
              <Stat valor={deploy.regiao} rotulo="região Vercel" />
            </div>
          </div>

          <p className="font-mono text-[11px] text-zinc-400 dark:text-zinc-600">
            medido em{" "}
            {agora.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" })}{" "}
            (America/Sao_Paulo) · sem cache, lido a cada visita
          </p>
        </div>
      </section>

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
                          {item.status === "descartado" && (
                            <span className="whitespace-nowrap rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                              ○ Escopo descartado{item.concluidoEm ? ` em ${item.concluidoEm}` : ""}
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
          O roadmap é renderizado a partir de <code>src/data/roadmap.ts</code>{" "}
          — cada item de &ldquo;Próximos passos&rdquo; é marcado como feito (ou
          descartado) no mesmo commit que entrega a mudança, então a lista
          reflete o deploy mais recente. As &ldquo;Métricas ao vivo&rdquo; são
          contagens agregadas lidas do Postgres de produção a cada visita.
        </span>
        <Link href="/" className="text-zinc-600 underline underline-offset-2 dark:text-zinc-400">
          ← Voltar
        </Link>
      </footer>
    </div>
  );
}
