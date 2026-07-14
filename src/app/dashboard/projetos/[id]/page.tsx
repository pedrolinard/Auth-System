"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
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

const ROTULOS_STATUS: Record<StatusTarefa, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  concluida: "Concluída",
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
    setErro(null);
    setAtualizandoId(tarefa.id);
    try {
      await atualizarStatusTarefa(tarefa.id, status);
      await carregar();
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setAtualizandoId(null);
    }
  }

  async function aoExcluirTarefa(id: number) {
    setErro(null);
    setExcluindoId(id);
    try {
      await excluirTarefa(id);
      await carregar();
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setExcluindoId(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <div className="flex w-full max-w-lg flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-black dark:text-zinc-50">
            {projeto?.nome ?? "Carregando..."}
          </h1>
          <Link
            href="/dashboard/projetos"
            className="text-sm text-zinc-600 underline dark:text-zinc-400"
          >
            Voltar aos projetos
          </Link>
        </div>

        {projeto?.descricao && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{projeto.descricao}</p>
        )}

        {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

        <form
          onSubmit={aoCriarTarefa}
          className="flex flex-col gap-3 rounded-xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-zinc-950"
        >
          <h2 className="text-sm font-medium text-black dark:text-zinc-50">Nova tarefa</h2>
          <input
            required
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Título da tarefa"
            className="rounded-md border border-black/[.08] px-3 py-2 text-sm dark:border-white/[.145] dark:bg-black"
          />
          <button
            type="submit"
            disabled={criando || !titulo}
            className="self-start rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {criando ? "Criando..." : "Criar tarefa"}
          </button>
        </form>

        {tarefas === null && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Carregando...</p>
        )}

        {tarefas?.length === 0 && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Nenhuma tarefa ainda.</p>
        )}

        {tarefas && tarefas.length > 0 && (
          <ul className="flex flex-col gap-3">
            {tarefas.map((tarefa) => (
              <li
                key={tarefa.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-black/[.08] bg-white p-4 dark:border-white/[.145] dark:bg-zinc-950"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-black dark:text-zinc-50">
                    {tarefa.titulo}
                  </p>
                  <select
                    value={tarefa.status}
                    onChange={(e) => aoMudarStatus(tarefa, e.target.value as StatusTarefa)}
                    disabled={atualizandoId === tarefa.id}
                    className="mt-1 rounded-md border border-black/[.08] bg-transparent px-2 py-1 text-xs dark:border-white/[.145]"
                  >
                    {Object.entries(ROTULOS_STATUS).map(([valor, rotulo]) => (
                      <option key={valor} value={valor}>
                        {rotulo}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => aoExcluirTarefa(tarefa.id)}
                  disabled={excluindoId === tarefa.id}
                  className="shrink-0 rounded-full border border-black/[.08] px-4 py-1.5 text-xs font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
                >
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
