import React from "react";
import { situacaoInfo } from "../../lib/certidoes";

/** Etiqueta colorida da situação da certidão (válida, a vencer, vencida...). */
export function BadgeSituacao({ situacao }) {
  const info = situacaoInfo(situacao);
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full whitespace-nowrap"
      style={{ color: info.cor, backgroundColor: info.bg }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: info.ponto }} />
      {info.label}
    </span>
  );
}

/** Etiqueta neutra usada nos tipos de documento (Obrigatório, Sem vencimento...). */
export function Etiqueta({ tom = "neutro", children }) {
  const estilos = {
    neutro: "bg-black/[0.04] text-[#0F2A44]/60",
    dourado: "bg-[#FBF4DE] text-[#8A7526]",
    inativo: "bg-red-50 text-red-600",
  };
  return (
    <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full ${estilos[tom]}`}>
      {children}
    </span>
  );
}
