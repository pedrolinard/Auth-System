import { AlertCircle } from "lucide-react";

// Erro de formulário inline — fica ao lado da ação que falhou (diferente do
// toast, que é pra resultado de operação em segundo plano). Ícone + texto,
// com um leve destaque de fundo pra não passar batido.
export function AvisoErro({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg bg-red-500/[.07] px-3 py-2 text-sm text-red-600 dark:text-red-400"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.25} />
      <span>{children}</span>
    </p>
  );
}
