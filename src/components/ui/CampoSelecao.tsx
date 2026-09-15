"use client";

import { useState, type SelectHTMLAttributes } from "react";
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
 * cor de destaque com foco, vira pra cima enquanto a lista está aberta e
 * pulsa enquanto a escolha é salva. Estilos em globals.css (.campo-selecao).
 */
export function CampoSelecao({
  classeContainer = "",
  tamanho = "md",
  ocupado = false,
  className = "",
  onChange,
  onBlur,
  onMouseDown,
  onKeyDown,
  children,
  ...props
}: Props) {
  // O navegador não avisa quando a lista nativa abre ou fecha: abre no clique,
  // e fecha no próximo clique, na escolha, no Esc ou ao perder o foco.
  const [aberto, setAberto] = useState(false);

  return (
    <span
      className={`campo-selecao relative inline-flex ${classeContainer}`}
      data-aberto={aberto}
      data-ocupado={ocupado}
    >
      <select
        {...props}
        className={`${tamanho === "sm" ? "pr-6" : "pr-8"} ${className}`}
        onMouseDown={(e) => {
          if (!props.disabled) setAberto((atual) => !atual);
          onMouseDown?.(e);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" || e.key === "Enter" || e.key === "Tab") setAberto(false);
          onKeyDown?.(e);
        }}
        onChange={(e) => {
          setAberto(false);
          onChange?.(e);
        }}
        onBlur={(e) => {
          setAberto(false);
          onBlur?.(e);
        }}
      >
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
