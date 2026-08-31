"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";

// Toast caseiro (sem dependência): um store module-level com listeners.
// `notificar.sucesso("...")` de qualquer lugar do cliente empilha um card no
// canto da tela. Trocou o feedback "texto vermelho/verde solto embaixo do
// form" por algo que aparece, chama atenção e some sozinho.

type Tipo = "sucesso" | "erro" | "info";
type Toast = { id: number; tipo: Tipo; mensagem: string };

let proximoId = 1;
let toasts: Toast[] = [];
const ouvintes = new Set<(lista: Toast[]) => void>();

function emitir() {
  for (const ouvinte of ouvintes) ouvinte(toasts);
}

function adicionar(tipo: Tipo, mensagem: string) {
  const id = proximoId++;
  toasts = [...toasts, { id, tipo, mensagem }];
  emitir();
  // 5s pra sucesso/info, 7s pra erro (a pessoa precisa de mais tempo pra ler
  // o que deu errado antes de sumir).
  window.setTimeout(() => remover(id), tipo === "erro" ? 7000 : 5000);
}

function remover(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emitir();
}

export const notificar = {
  sucesso: (mensagem: string) => adicionar("sucesso", mensagem),
  erro: (mensagem: string) => adicionar("erro", mensagem),
  info: (mensagem: string) => adicionar("info", mensagem),
};

const ICONE: Record<Tipo, typeof Check> = {
  sucesso: Check,
  erro: AlertTriangle,
  info: Info,
};

const COR_ICONE: Record<Tipo, string> = {
  sucesso: "text-[var(--accent)]",
  erro: "text-red-600 dark:text-red-400",
  info: "text-zinc-500 dark:text-zinc-400",
};

export function Toaster() {
  const [lista, setLista] = useState<Toast[]>(toasts);

  useEffect(() => {
    ouvintes.add(setLista);
    return () => {
      ouvintes.delete(setLista);
    };
  }, []);

  if (lista.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6">
      {lista.map((toast) => {
        const Icone = ICONE[toast.tipo];
        return (
          <div
            key={toast.id}
            role="status"
            className="card-surface pointer-events-auto flex w-full max-w-sm items-start gap-3 p-3.5 pr-2.5"
            style={{ animation: "toast-entra 0.32s cubic-bezier(0.16, 1, 0.3, 1) both" }}
          >
            <Icone className={`mt-0.5 h-4 w-4 shrink-0 ${COR_ICONE[toast.tipo]}`} strokeWidth={2.5} />
            <p className="flex-1 text-sm text-foreground">{toast.mensagem}</p>
            <button
              onClick={() => remover(toast.id)}
              aria-label="Fechar aviso"
              className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-black/[.04] hover:text-foreground dark:hover:bg-white/[.06]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
