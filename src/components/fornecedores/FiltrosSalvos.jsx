import React from "react";
import { Star, X } from "lucide-react";

/**
 * Atalhos dos filtros salvos pelo usuário: clicar aplica a combinação inteira
 * de uma vez; o "x" apaga o atalho.
 */
export default function FiltrosSalvos({ favoritos, carregando, erro, onAplicar, onExcluir }) {
  if (carregando) {
    return <p className="text-[11px] text-[#0F2A44]/40 mt-3">Carregando filtros salvos...</p>;
  }
  if (erro) {
    return <p className="text-[11px] text-red-600 mt-3">{erro}</p>;
  }
  if (favoritos.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="flex items-center gap-1 text-xs font-medium text-[#0F2A44]/70 mr-1">
        <Star size={13} /> Filtros salvos
      </span>
      {favoritos.map((favorito) => (
        <span
          key={favorito.id}
          className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white text-xs text-[#0F2A44]"
        >
          <button
            type="button"
            onClick={() => onAplicar(favorito)}
            title={`Aplicar filtro salvo: ${favorito.nome}`}
            className="pl-3 pr-1 py-1 rounded-l-full hover:bg-black/5"
          >
            {favorito.nome}
          </button>
          <button
            type="button"
            onClick={() => onExcluir(favorito)}
            title={`Excluir filtro salvo: ${favorito.nome}`}
            className="pr-2.5 py-1 rounded-r-full text-[#0F2A44]/40 hover:text-red-500"
          >
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}
