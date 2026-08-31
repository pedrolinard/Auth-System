"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, FolderKanban, Plus, Trash2 } from "lucide-react";
import {
  criarProjeto,
  excluirProjeto,
  listarProjetos,
  type Projeto,
} from "@/lib/clienteDominio";
import { AvisoErro } from "@/components/ui/AvisoErro";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import { SkeletonLista } from "@/components/ui/Skeleton";
import { notificar } from "@/components/ui/Toaster";

export default function PaginaProjetos() {
  const [projetos, setProjetos] = useState<Projeto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [criando, setCriando] = useState(false);
  const [excluindoId, setExcluindoId] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    try {
      setProjetos(await listarProjetos());
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar();
  }, [carregar]);

  async function aoCriar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setCriando(true);
    try {
      await criarProjeto({ nome, descricao: descricao || undefined });
      setNome("");
      setDescricao("");
      await carregar();
      notificar.sucesso("Projeto criado.");
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setCriando(false);
    }
  }

  async function aoExcluir(projeto: Projeto) {
    setErro(null);
    setExcluindoId(projeto.id);
    const anterior = projetos;
    setProjetos((atual) => atual?.filter((p) => p.id !== projeto.id) ?? null);
    try {
      await excluirProjeto(projeto.id);
      notificar.info(`"${projeto.nome}" foi excluído.`);
    } catch (erroCapturado) {
      setProjetos(anterior ?? null);
      notificar.erro(
        erroCapturado instanceof Error ? erroCapturado.message : "Não deu pra excluir o projeto.",
      );
    } finally {
      setExcluindoId(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-6 py-10">
      <div className="flex w-full min-w-0 max-w-lg flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="eyebrow text-zinc-500 dark:text-zinc-500">Domínio</span>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Projetos</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Organize seu trabalho em projetos e acompanhe as tarefas de cada um.
          </p>
        </div>

        <AvisoErro>{erro}</AvisoErro>

        <form onSubmit={aoCriar} className="card-surface flex flex-col gap-3 p-6">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Plus className="h-4 w-4 text-zinc-400" aria-hidden="true" />
            Novo projeto
          </h2>
          <input
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome do projeto"
            className="input-field"
          />
          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Descrição (opcional)"
            rows={2}
            className="input-field resize-none"
          />
          <button type="submit" disabled={criando || !nome} className="btn-primary self-start">
            {criando ? "Criando..." : "Criar projeto"}
          </button>
        </form>

        {projetos === null && <SkeletonLista linhas={3} />}

        {projetos?.length === 0 && (
          <EstadoVazio
            icone={FolderKanban}
            titulo="Nenhum projeto ainda"
            descricao="Crie o primeiro acima e ele aparece aqui, pronto pra receber tarefas."
          />
        )}

        {projetos && projetos.length > 0 && (
          <ul className="surgir-em-cascata flex flex-col gap-3">
            {projetos.map((projeto) => (
              <li
                key={projeto.id}
                className="card-surface group flex min-w-0 items-center gap-3 p-4 transition-transform duration-150 hover:-translate-y-0.5"
              >
                <Link
                  href={`/dashboard/projetos/${projeto.id}`}
                  className="flex min-w-0 flex-1 items-center gap-3 text-sm text-foreground"
                >
                  <span className="chip-secao">
                    <FolderKanban className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{projeto.nome}</span>
                    {projeto.descricao && (
                      <span className="block truncate text-xs text-zinc-600 dark:text-zinc-400">
                        {projeto.descricao}
                      </span>
                    )}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300 transition-transform group-hover:translate-x-0.5 dark:text-zinc-600" />
                </Link>
                <button
                  onClick={() => aoExcluir(projeto)}
                  disabled={excluindoId === projeto.id}
                  className="btn-secondary-sm shrink-0 gap-1.5"
                  aria-label={`Excluir projeto ${projeto.nome}`}
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                  {excluindoId === projeto.id ? "Excluindo..." : "Excluir"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
