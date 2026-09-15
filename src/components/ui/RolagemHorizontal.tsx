"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Folga (px) pra considerar que chegou na ponta — arredondamento de subpixel
// deixa scrollLeft a 0,5px do fim em telas com zoom.
const FOLGA = 2;
// Quanto do item ativo precisa sobrar longe da borda (px) pra ele contar como
// visível — colado na borda ele fica embaixo do esmaecimento e da seta.
const MARGEM_ATIVO = 40;

function preferenciaMovimento(): ScrollBehavior {
  if (typeof window === "undefined") return "auto";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

type Props = {
  children: ReactNode;
  className?: string;
  /** Setas sobre as bordas pra rolar com o mouse (o menu do painel). */
  setas?: boolean;
  /** Esconde a barra nativa — só faz sentido junto das setas. */
  semBarra?: boolean;
  /**
   * Muda quando o item ativo muda (ex.: a rota) ou quando os itens mudam. O
   * elemento com aria-current="page" é trazido pra área visível, centralizado.
   * Não roda a cada renderização: quem rolou o menu na mão não é puxado de volta.
   */
  chaveAtivo?: string;
  /** A roda vertical do mouse rola na horizontal enquanto houver pra onde ir. */
  rodaVertical?: boolean;
};

/**
 * Contêiner de rolagem horizontal com as bordas esmaecendo do lado em que
 * ainda há conteúdo e, opcionalmente, setas pra rolar. Usado no menu do
 * painel e nas tabelas largas (usuários, auditoria) — antes eram um
 * `overflow-x-auto` cru: em tela estreita metade do menu ficava escondida sem
 * nenhum indício de que existia.
 */
export function RolagemHorizontal({
  children,
  className = "",
  setas = false,
  semBarra = false,
  chaveAtivo,
  rodaVertical = false,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [maisInicio, setMaisInicio] = useState(false);
  const [maisFim, setMaisFim] = useState(false);
  const primeiraCentralizacao = useRef(true);

  const medir = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setMaisInicio(el.scrollLeft > FOLGA);
    setMaisFim(el.scrollLeft + el.clientWidth < el.scrollWidth - FOLGA);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let quadro = 0;
    const agendar = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(medir);
    };
    medir();
    el.addEventListener("scroll", agendar, { passive: true });
    // Mede de novo quando o contêiner OU o conteúdo muda de largura: itens
    // do menu aparecem depois que o usuário carrega (restritos a admin), e as
    // tabelas mudam de tamanho com o filtro.
    const observador = new ResizeObserver(agendar);
    observador.observe(el);
    if (el.firstElementChild) observador.observe(el.firstElementChild);
    return () => {
      cancelAnimationFrame(quadro);
      el.removeEventListener("scroll", agendar);
      observador.disconnect();
    };
  }, [medir]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !rodaVertical) return;
    const aoRolar = (evento: WheelEvent) => {
      if (Math.abs(evento.deltaX) >= Math.abs(evento.deltaY)) return;
      const podeIr =
        evento.deltaY > 0
          ? el.scrollLeft + el.clientWidth < el.scrollWidth - FOLGA
          : el.scrollLeft > FOLGA;
      // Na ponta, devolve a roda pra página em vez de prender o usuário.
      if (!podeIr) return;
      evento.preventDefault();
      el.scrollLeft += evento.deltaY;
    };
    el.addEventListener("wheel", aoRolar, { passive: false });
    return () => el.removeEventListener("wheel", aoRolar);
  }, [rodaVertical]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || chaveAtivo === undefined) return;
    const ativo = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (!ativo) return;
    // Na primeira vez (página recém-aberta) pula direto; depois, desliza.
    const comportamento = primeiraCentralizacao.current ? "auto" : preferenciaMovimento();
    primeiraCentralizacao.current = false;
    const caixa = el.getBoundingClientRect();
    const alvo = ativo.getBoundingClientRect();
    const visivel =
      alvo.left >= caixa.left + MARGEM_ATIVO && alvo.right <= caixa.right - MARGEM_ATIVO;
    if (visivel) return;
    const inicio = alvo.left - caixa.left + el.scrollLeft;
    el.scrollTo({ left: inicio - (el.clientWidth - alvo.width) / 2, behavior: comportamento });
  }, [chaveAtivo]);

  function rolar(direcao: -1 | 1) {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: direcao * el.clientWidth * 0.6, behavior: preferenciaMovimento() });
  }

  return (
    <div className={`relative min-w-0 ${className}`}>
      <div
        ref={ref}
        data-mais-inicio={maisInicio}
        data-mais-fim={maisFim}
        className={`rolagem-horizontal ${semBarra ? "sem-barra" : ""}`}
      >
        {children}
      </div>
      {setas && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            data-visivel={maisInicio}
            onClick={() => rolar(-1)}
            className="seta-rolagem left-0"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.25} />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            data-visivel={maisFim}
            onClick={() => rolar(1)}
            className="seta-rolagem right-0"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </>
      )}
    </div>
  );
}
