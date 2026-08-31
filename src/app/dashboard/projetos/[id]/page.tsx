"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ListTodo, Plus, Trash2 } from "lucide-react";
import {
  atualizarStatusTarefa,
  criarTarefa,
  excluirTarefa,
  listarTarefas,
  obterProjeto,
  type Projeto,
  type StatusTarefa,
  type Tarefa,
} from "@/lib/clienteDominio";
import { AvisoErro } from "@/components/ui/AvisoErro";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import { Skeleton, SkeletonLista } from "@/components/ui/Skeleton";
import { notificar } from "@/components/ui/Toaster";

const ROTULOS_STATUS: Record<StatusTarefa, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  concluida: "Concluída",
};

const COR_STATUS: Record<StatusTarefa, string> = {
  pendente: "text-zinc-500 dark:text-zinc-400",
  em_andamento: "text-amber-600 dark:text-amber-400",
  concluida: "text-[var(--accent)]",
};

export default function PaginaProjeto() {
  const params = useParams<{ id: string }>();
  const projetoId = Number(params.id);

  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [tarefas, setTarefas] = useState<Tarefa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [titulo, setTitulo] = useState("");
  const [criando, setCriando] = useState(false);
  const [atualizandoId, setAtualizandoId] = useState<number | null>(null);
  const [excluindoId, setExcluindoId] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [dadosProjeto, dadosTarefas] = await Promise.all([
        obterProjeto(projetoId),
        listarTarefas(projetoId),
      ]);
      setProjeto(dadosProjeto);
      setTarefas(dadosTarefas);
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    }
  }, [projetoId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar();
  }, [carregar]);

  const progresso = useMemo(() => {
    if (!tarefas || tarefas.length === 0) return null;
    const concluidas = tarefas.filter((t) => t.status === "concluida").length;
    return { concluidas, total: tarefas.length, pct: Math.round((concluidas / tarefas.length) * 100) };
  }, [tarefas]);

  async function aoCriarTarefa(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setCriando(true);
    try {
      await criarTarefa({ titulo, projeto: projetoId });
      setTitulo("");
      await carregar();
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setCriando(false);
    }
  }

  async function aoMudarStatus(tarefa: Tarefa, status: StatusTarefa) {
    setAtualizandoId(tarefa.id);
    const anterior = tarefas;
    setTarefas((atual) =>
      atual?.map((t) => (t.id === tarefa.id ? { ...t, status } : t)) ?? null,
    );
    try {
      await atualizarStatusTarefa(tarefa.id, status);
    } catch (erroCapturado) {
      setTarefas(anterior ?? null);
      notificar.erro(
        erroCapturado instanceof Error ? erroCapturado.message : "Não deu pra mudar o status.",
      );
    } finally {
      setAtualizandoId(null);
    }
  }

  async function aoExcluirTarefa(tarefa: Tarefa) {
    setExcluindoId(tarefa.id);
    const anterior = tarefas;
    setTarefas((atual) => atual?.filter((t) => t.id !== tarefa.id) ?? null);
    try {
      await excluirTarefa(tarefa.id);
      notificar.info("Tarefa excluída.");
    } catch (erroCapturado) {
      setTarefas(anterior ?? null);
      notificar.erro(
        erroCapturado instanceof Error ? erroCapturado.message : "Não deu pra excluir a tarefa.",
      );
    } finally {
      setExcluindoId(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-6 py-10">
      <div className="flex w-full min-w-0 max-w-lg flex-col gap-4">
        <Link
          href="/dashboard/projetos"
          className="flex items-center gap-1.5 self-start text-sm text-zinc-500 transition-colors hover:text-foreground dark:text-zinc-400"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Projetos
        </Link>

        <div className="flex flex-col gap-1">
          <span className="eyebrow text-zinc-500 dark:text-zinc-500">Domínio</span>
          {projeto ? (
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{projeto.nome}</h1>
          ) : (
            <Skeleton className="h-8 w-48" />
          )}
          {projeto?.descricao && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{projeto.descricao}</p>
          )}
        </div>

        {progresso && (
          <div className="flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[.07] dark:bg-white/[.09]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
                style={{ width: `${progresso.pct}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              {progresso.concluidas}/{progresso.total} concluídas
            </span>
          </div>
        )}

        <AvisoErro>{erro}</AvisoErro>

        <form onSubmit={aoCriarTarefa} className="card-surface flex flex-col gap-3 p-6">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Plus className="h-4 w-4 text-zinc-400" aria-hidden="true" />
            Nova tarefa
          </h2>
          <input
            required
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="O que precisa ser feito?"
            className="input-field"
          />
          <button type="submit" disabled={criando || !titulo} className="btn-primary self-start">
            {criando ? "Criando..." : "Criar tarefa"}
          </button>
        </form>

        {tarefas === null && <SkeletonLista linhas={3} />}

        {tarefas?.length === 0 && (
          <EstadoVazio
            icone={ListTodo}
            titulo="Nenhuma tarefa ainda"
            descricao="Adicione a primeira acima. Dá pra marcar o andamento de cada uma depois."
          />
        )}

        {tarefas && tarefas.length > 0 && (
          <ul className="surgir-em-cascata flex flex-col gap-3">
            {tarefas.map((tarefa) => (
              <li
                key={tarefa.id}
                className="card-surface flex min-w-0 items-center gap-3 p-4"
              >
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-sm font-medium ${
                      tarefa.status === "concluida"
                        ? "text-zinc-400 line-through dark:text-zinc-600"
                        : "text-foreground"
                    }`}
                  >
                    {tarefa.titulo}
                  </p>
                  <select
                    value={tarefa.status}
                    onChange={(e) => aoMudarStatus(tarefa, e.target.value as StatusTarefa)}
                    disabled={atualizandoId === tarefa.id}
                    className={`mt-1.5 rounded-md border border-black/[.09] bg-transparent px-2 py-1 text-xs font-medium outline-none focus:border-[var(--accent)] disabled:opacity-50 dark:border-white/[.13] ${COR_STATUS[tarefa.status]}`}
                  >
                    {Object.entries(ROTULOS_STATUS).map(([valor, rotulo]) => (
                      <option key={valor} value={valor}>
                        {rotulo}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => aoExcluirTarefa(tarefa)}
                  disabled={excluindoId === tarefa.id}
                  className="btn-secondary-sm shrink-0 gap-1.5"
                  aria-label={`Excluir tarefa ${tarefa.titulo}`}
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                  {excluindoId === tarefa.id ? "Excluindo..." : "Excluir"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
