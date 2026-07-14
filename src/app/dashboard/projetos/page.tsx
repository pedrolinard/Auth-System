"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  criarProjeto,
  excluirProjeto,
  listarProjetos,
  type Projeto,
} from "@/lib/clienteDominio";

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
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setCriando(false);
    }
  }

  async function aoExcluir(id: number) {
    setErro(null);
    setExcluindoId(id);
    try {
      await excluirProjeto(id);
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
          <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Projetos</h1>
          <Link
            href="/dashboard"
            className="text-sm text-zinc-600 underline dark:text-zinc-400"
          >
            Voltar ao dashboard
          </Link>
        </div>

        {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

        <form
          onSubmit={aoCriar}
          className="flex flex-col gap-3 rounded-xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-zinc-950"
        >
          <h2 className="text-sm font-medium text-black dark:text-zinc-50">Novo projeto</h2>
          <input
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome do projeto"
            className="rounded-md border border-black/[.08] px-3 py-2 text-sm dark:border-white/[.145] dark:bg-black"
          />
          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Descrição (opcional)"
            rows={2}
            className="rounded-md border border-black/[.08] px-3 py-2 text-sm dark:border-white/[.145] dark:bg-black"
          />
          <button
            type="submit"
            disabled={criando || !nome}
            className="self-start rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {criando ? "Criando..." : "Criar projeto"}
          </button>
        </form>

        {projetos === null && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Carregando...</p>
        )}

        {projetos?.length === 0 && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Nenhum projeto ainda.</p>
        )}

        {projetos && projetos.length > 0 && (
          <ul className="flex flex-col gap-3">
            {projetos.map((projeto) => (
              <li
                key={projeto.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-black/[.08] bg-white p-4 dark:border-white/[.145] dark:bg-zinc-950"
              >
                <Link
                  href={`/dashboard/projetos/${projeto.id}`}
                  className="flex-1 text-sm text-black hover:underline dark:text-zinc-50"
                >
                  <p className="font-medium">{projeto.nome}</p>
                  {projeto.descricao && (
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">
                      {projeto.descricao}
                    </p>
                  )}
                </Link>
                <button
                  onClick={() => aoExcluir(projeto.id)}
                  disabled={excluindoId === projeto.id}
                  className="shrink-0 rounded-full border border-black/[.08] px-4 py-1.5 text-xs font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
                >
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
