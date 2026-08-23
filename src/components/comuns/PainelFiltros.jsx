import React from "react";
import { ChevronDown, ChevronUp, Eraser, SlidersHorizontal, X } from "lucide-react";

/**
 * Painel de filtros recolhível, compartilhado pelas telas de listagem.
 *
 * O componente é só apresentação: ele mostra ou esconde os filtros que a tela
 * já tinha, sem tocar em nenhum valor. Os campos ficam SEMPRE montados (só o
 * contêiner é escondido), então recolher nunca limpa o que foi digitado, nunca
 * cancela o que já foi aplicado e nunca muda o resultado da tela.
 *
 * Como usar:
 *   * `topo`     -- o que continua visível com o painel fechado (busca rápida,
 *                   ordenação, filtros salvos...).
 *   * `children` -- os filtros que abrem e fecham.
 *   * `chips`    -- um item por filtro ativo: `{ chave, rotulo, remover? }`.
 *                   Sem `remover`, o chip só informa (filtro que sempre tem
 *                   valor, como a data escolhida).
 *   * `onLimpar` -- ação de limpar tudo; o botão aparece na barra quando o
 *                   painel está fechado e há filtros ativos.
 *
 * O estado aberto/fechado vive aqui: começa fechado a cada abertura da tela e
 * permanece como a pessoa deixou enquanto ela estiver naquela tela.
 */
export default function PainelFiltros({
  rotulo = "Filtros",
  chips = [],
  totalAtivos,
  onLimpar,
  topo = null,
  rodape = null,
  resumo = null,
  children,
  className = "",
}) {
  const [aberto, setAberto] = React.useState(false);
  const corpoRef = React.useRef(null);
  const idCorpo = React.useId();

  const ativos = typeof totalAtivos === "number" ? totalAtivos : chips.length;
  const temAtivos = ativos > 0;

  // Fechado, o conteúdo continua no DOM (para não perder nada do formulário),
  // mas sai da navegação por teclado e dos leitores de tela.
  React.useEffect(() => {
    const elemento = corpoRef.current;
    if (!elemento) return;
    if (aberto) elemento.removeAttribute("inert");
    else elemento.setAttribute("inert", "");
  }, [aberto]);

  return (
    <section className={`bg-white rounded-2xl border border-black/5 shadow-sm print:hidden ${className}`}>
      {topo && <div className="px-4 sm:px-5 pt-4">{topo}</div>}

      <div className="flex flex-wrap items-center gap-2 px-4 sm:px-5 py-3">
        <button
          type="button"
          onClick={() => setAberto((atual) => !atual)}
          aria-expanded={aberto}
          aria-controls={idCorpo}
          className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border transition-colors ${
            aberto || temAtivos
              ? "bg-[#0F2A44] text-white border-[#0F2A44]"
              : "border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
          }`}
        >
          <SlidersHorizontal size={15} />
          <span>
            {rotulo}
            {!aberto && temAtivos && ` • ${ativos} ${ativos === 1 ? "ativo" : "ativos"}`}
          </span>
          {aberto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {resumo && <div className="text-xs text-[#0F2A44]/45">{resumo}</div>}

        {!aberto && temAtivos && onLimpar && (
          <button
            type="button"
            onClick={onLimpar}
            className="ml-auto flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
          >
            <Eraser size={14} /> Limpar filtros
          </button>
        )}
      </div>

      {!aberto && chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 sm:px-5 pb-3 -mt-1">
          {chips.map((chip) => (
            <span
              key={chip.chave}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-[#EAF1FF] text-[#0F2A44]"
            >
              {chip.rotulo}
              {chip.remover && (
                <button
                  type="button"
                  onClick={chip.remover}
                  title={`Remover filtro: ${chip.rotulo}`}
                  className="text-[#0F2A44]/40 hover:text-red-500"
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Transição de altura sem saber a altura: as linhas do grid vão de 0fr a 1fr. */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: aberto ? "1fr" : "0fr" }}
      >
        <div ref={corpoRef} id={idCorpo} className="overflow-hidden">
          <div className="px-4 sm:px-5 pb-4 pt-1 border-t border-black/5">{children}</div>
        </div>
      </div>

      {rodape && <div className="px-4 sm:px-5 pb-4">{rodape}</div>}
    </section>
  );
}
