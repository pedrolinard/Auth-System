"use client";

import { obterTokenAcesso, tentarAtualizarToken } from "./clienteAuth";

export type StatusTarefa = "pendente" | "em_andamento" | "concluida";

export type Projeto = {
  id: number;
  nome: string;
  descricao: string;
  usuario_id: string;
  criado_em: string;
};

export type Tarefa = {
  id: number;
  titulo: string;
  descricao: string;
  status: StatusTarefa;
  prazo: string | null;
  projeto: number;
  usuario_id: string;
  criado_em: string;
  atualizado_em: string;
};

async function requisicaoAutenticada(
  caminho: string,
  opcoes: RequestInit = {},
  tentouRenovar = false,
): Promise<Response> {
  const token = obterTokenAcesso();
  const resposta = await fetch(caminho, {
    ...opcoes,
    headers: {
      ...(opcoes.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (resposta.status === 401 && !tentouRenovar) {
    const renovado = await tentarAtualizarToken();
    if (renovado) return requisicaoAutenticada(caminho, opcoes, true);
  }

  return resposta;
}

async function corpoOuErro(resposta: Response) {
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const mensagem = corpo?.detail ?? (corpo ? JSON.stringify(corpo) : "Falha na requisição.");
    throw new Error(mensagem);
  }
  return corpo;
}

export async function listarProjetos(): Promise<Projeto[]> {
  const resposta = await requisicaoAutenticada("/api/dominio/projetos");
  return corpoOuErro(resposta);
}

export async function obterProjeto(id: number): Promise<Projeto> {
  const resposta = await requisicaoAutenticada(`/api/dominio/projetos/${id}`);
  return corpoOuErro(resposta);
}

export async function criarProjeto(dados: {
  nome: string;
  descricao?: string;
}): Promise<Projeto> {
  const resposta = await requisicaoAutenticada("/api/dominio/projetos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados),
  });
  return corpoOuErro(resposta);
}

export async function excluirProjeto(id: number): Promise<void> {
  const resposta = await requisicaoAutenticada(`/api/dominio/projetos/${id}`, {
    method: "DELETE",
  });
  if (!resposta.ok) throw new Error("Falha ao excluir projeto.");
}

export async function listarTarefas(projetoId: number): Promise<Tarefa[]> {
  const resposta = await requisicaoAutenticada(
    `/api/dominio/tarefas?projeto=${projetoId}`,
  );
  return corpoOuErro(resposta);
}

export async function criarTarefa(dados: {
  titulo: string;
  projeto: number;
  descricao?: string;
  prazo?: string | null;
}): Promise<Tarefa> {
  const resposta = await requisicaoAutenticada("/api/dominio/tarefas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados),
  });
  return corpoOuErro(resposta);
}

export async function atualizarStatusTarefa(
  id: number,
  status: StatusTarefa,
): Promise<Tarefa> {
  const resposta = await requisicaoAutenticada(`/api/dominio/tarefas/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  return corpoOuErro(resposta);
}

export async function excluirTarefa(id: number): Promise<void> {
  const resposta = await requisicaoAutenticada(`/api/dominio/tarefas/${id}`, {
    method: "DELETE",
  });
  if (!resposta.ok) throw new Error("Falha ao excluir tarefa.");
}
