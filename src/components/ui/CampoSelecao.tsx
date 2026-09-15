import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  /** Classes do contêiner — cor do texto vai aqui, pra seta herdar a mesma. */
  classeContainer?: string;
  /** Posição e tamanho da seta: "sm" pra selects compactos (text-xs). */
  tamanho?: "sm" | "md";
  /** Mostra a seta pulsando enquanto a escolha está sendo salva. */
  ocupado?: boolean;
};

/**
 * <select> nativo com a seta do painel no lugar da do navegador. Continua
 * sendo um select de verdade (teclado, leitor de tela, menu nativo no
 * celular); só a parte visual muda: a seta desce um pouco no hover, fica na
 * cor de destaque com foco e pulsa enquanto a escolha é salva. Estilos em
 * globals.css (.campo-selecao).
 *
 * Sem estado de "lista aberta" de propósito: o navegador não avisa quando a
 * lista nativa abre ou fecha. Escolher a mesma opção não dispara change nem
 * blur, e abrir pelo teclado não passa por clique — uma seta virada pra cima
 * ficava presa com a lista já fechada.
 */
export function CampoSelecao({
  classeContainer = "",
  tamanho = "md",
  ocupado = false,
  className = "",
  children,
  ...props
}: Props) {
  return (
    <span className={`campo-selecao relative inline-flex ${classeContainer}`} data-ocupado={ocupado}>
      <select {...props} className={`${tamanho === "sm" ? "pr-6" : "pr-8"} ${className}`}>
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        strokeWidth={2.25}
        className={`chevron-selecao ${tamanho === "sm" ? "right-1.5 h-3 w-3" : "right-2.5 h-3.5 w-3.5"}`}
      />
    </span>
  );
}
