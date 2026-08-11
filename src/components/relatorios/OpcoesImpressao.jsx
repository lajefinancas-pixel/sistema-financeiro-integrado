import React from "react";
import { MODOS_IMPRESSAO, textoOrientacao } from "../../lib/relatoriosCabecalho";

// Escolha do formato de impressão do relatório, usada tanto nos relatórios
// prontos quanto nos personalizados e nos comparativos.
//
// A orientação da folha não é escolhida aqui: ela é definida automaticamente pela
// quantidade de colunas do relatório (paisagem quando são muitas). O texto ao lado
// só informa o que vai sair.

export default function OpcoesImpressao({ modo, onModo, colunas }) {
  const atual = MODOS_IMPRESSAO.find((m) => m.id === modo) ?? MODOS_IMPRESSAO[0];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div
        className="flex items-center gap-1 rounded-lg border border-black/10 bg-white p-1"
        role="group"
        aria-label="Formato de impressão"
      >
        {MODOS_IMPRESSAO.map((item) => (
          <button
            key={item.id}
            onClick={() => onModo(item.id)}
            title={item.descricao}
            aria-pressed={atual.id === item.id}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              atual.id === item.id
                ? "bg-[#0F2A44] text-white font-medium"
                : "text-[#0F2A44]/60 hover:bg-black/5"
            }`}
          >
            {item.rotulo}
          </button>
        ))}
      </div>
      <span className="text-[11px] text-[#0F2A44]/45">{textoOrientacao(colunas)}</span>
    </div>
  );
}
