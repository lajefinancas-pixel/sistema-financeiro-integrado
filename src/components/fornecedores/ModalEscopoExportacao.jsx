import React from "react";
import { Printer, FileText, FileSpreadsheet } from "lucide-react";

const ROTULOS = {
  imprimir: { titulo: "Imprimir", Icone: Printer },
  pdf: { titulo: "Gerar PDF", Icone: FileText },
  excel: { titulo: "Exportar para Excel", Icone: FileSpreadsheet },
};

/**
 * Aparece só quando há filtros ativos: pergunta se a exportação leva apenas os
 * resultados filtrados ou a lista inteira de fornecedores.
 */
export default function ModalEscopoExportacao({ tipo, quantidadeFiltrada, quantidadeTotal, onEscolher, onCancelar }) {
  const { titulo, Icone } = ROTULOS[tipo] ?? ROTULOS.imprimir;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 print:hidden"
      onClick={onCancelar}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="flex items-center gap-2 text-base font-semibold text-[#0F2A44]">
          <Icone size={16} /> {titulo}
        </h2>
        <p className="text-sm text-[#0F2A44]/60 mt-1.5">
          Há filtros ativos na listagem. O que deve entrar no arquivo?
        </p>

        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={() => onEscolher("filtrados")}
            className="w-full text-left px-4 py-3 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90"
          >
            <div className="text-sm font-medium">Somente resultados filtrados</div>
            <div className="text-xs text-white/70 mt-0.5">{quantidadeFiltrada} fornecedores</div>
          </button>
          <button
            type="button"
            onClick={() => onEscolher("todos")}
            className="w-full text-left px-4 py-3 rounded-lg border border-black/10 text-[#0F2A44] hover:bg-black/5"
          >
            <div className="text-sm font-medium">Todos os fornecedores</div>
            <div className="text-xs text-[#0F2A44]/50 mt-0.5">{quantidadeTotal} fornecedores</div>
          </button>
        </div>

        <button
          type="button"
          onClick={onCancelar}
          className="mt-3 w-full text-sm px-4 py-2.5 rounded-lg text-[#0F2A44]/60 hover:bg-black/5"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
