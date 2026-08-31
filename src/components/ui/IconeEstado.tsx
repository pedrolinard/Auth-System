import { Loader2 } from "lucide-react";

// Ícone circular de estado pras telas de resultado (verificação de e-mail,
// confirmação de troca, redefinição concluída). O check é desenhado com
// animação de traço — pequeno detalhe que faz a tela "acontecer" em vez de
// só trocar de texto.

type Estado = "carregando" | "sucesso" | "erro";

export function IconeEstado({ estado }: { estado: Estado }) {
  if (estado === "carregando") {
    return (
      <div className="chip-secao h-12 w-12 rounded-2xl">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  const cor =
    estado === "sucesso"
      ? "border-[var(--accent)]/30 bg-[var(--accent-wash)] text-[var(--accent)]"
      : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400";

  return (
    <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${cor}`}>
      <svg viewBox="0 0 24 24" fill="none" className="marca-check h-6 w-6" aria-hidden="true">
        {estado === "sucesso" ? (
          <path
            d="M5 13l4 4L19 7"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </div>
  );
}
