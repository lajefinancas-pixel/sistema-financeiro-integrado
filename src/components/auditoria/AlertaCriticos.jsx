import React from "react";
import { AlertTriangle, Eraser, ListFilter } from "lucide-react";

/**
 * Destaque que abre a lista de Auditoria quando o sistema registrou ações críticas
 * nas últimas horas. O contador vem do banco e não depende dos filtros da tela: o
 * aviso é sobre o sistema, não sobre o recorte que está sendo consultado.
 *
 * O botão do destaque filtra a lista para mostrar apenas esses eventos; com o
 * atalho valendo, ele passa a oferecer a saída do filtro.
 */
export default function AlertaCriticos({ total = 0, horas = 24, ativo = false, onFiltrar, onLimpar }) {
  if (!total) return null;

  const plural = total === 1;
  const texto = plural
    ? "1 ação crítica registrada"
    : `${total} ações críticas registradas`;

  return (
    <div
      role="status"
      className="flex flex-col sm:flex-row sm:items-center gap-3 bg-red-50 border border-red-200 rounded-2xl px-4 py-3.5 mb-5"
    >
      <div className="flex items-start sm:items-center gap-2.5 flex-1 min-w-0">
        <span className="w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0">
          <AlertTriangle size={16} />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-red-700">
            ⚠️ {texto} nas últimas {horas} horas
          </div>
          <div className="text-xs text-red-700/70 mt-0.5">
            {ativo
              ? "A lista abaixo está mostrando somente esses eventos."
              : "Confira o que aconteceu antes de seguir com as próximas ações."}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={ativo ? onLimpar : onFiltrar}
        className={`shrink-0 self-start sm:self-auto flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-lg ${
          ativo
            ? "border border-red-300 text-red-700 hover:bg-red-100"
            : "bg-red-600 text-white hover:bg-red-700"
        }`}
      >
        {ativo ? <Eraser size={14} /> : <ListFilter size={14} />}
        {ativo ? "Remover filtro" : "Ver somente esses eventos"}
      </button>
    </div>
  );
}
