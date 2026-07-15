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
    <div className="flex flex-1 flex-col items-center gap-6 px-6 py-16">
      <div className="flex w-full max-w-lg flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="eyebrow text-zinc-500 dark:text-zinc-500">Domínio</span>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Projetos</h1>
          </div>
          <Link href="/dashboard" className="link-underline text-sm text-zinc-600 dark:text-zinc-400">
            Voltar ao dashboard
          </Link>
        </div>

        {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

        <form onSubmit={aoCriar} className="card-surface flex flex-col gap-3 p-6">
          <h2 className="text-sm font-medium text-foreground">Novo projeto</h2>
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
            className="input-field"
          />
          <button type="submit" disabled={criando || !nome} className="btn-primary self-start">
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
                className="card-surface flex items-center justify-between gap-3 p-4"
              >
                <Link
                  href={`/dashboard/projetos/${projeto.id}`}
                  className="flex-1 text-sm text-foreground hover:underline"
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
                  className="btn-secondary-sm shrink-0"
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
