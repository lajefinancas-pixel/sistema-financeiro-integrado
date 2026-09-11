import React from "react";
import { ORDENS_DA_RELACAO } from "../../lib/relacaoDeValores";

// As duas escolhas de quem emite a relação de valores: a ordem das linhas e se
// a relação leva só os registros com saldo em aberto.
//
// Nada aqui muda o que a tela mostra ou o que está gravado: são opções do
// documento, aplicadas na hora de gerar.

export default function OpcoesRelacaoValores({ opcoes, onOpcoes, className = "" }) {
  const ordem = opcoes?.ordem ?? ORDENS_DA_RELACAO[0].id;
  const somenteEmAberto = opcoes?.somenteEmAberto === true;
  const alterar = (mudanca) => onOpcoes({ ordem, somenteEmAberto, ...mudanca });

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${className}`}>
      <div
        className="flex items-center gap-1 rounded-lg border border-black/10 bg-white p-1"
        role="group"
        aria-label="Ordem da relação"
      >
        {ORDENS_DA_RELACAO.map((item) => (
          <button
            key={item.id}
            onClick={() => alterar({ ordem: item.id })}
            title={item.descricao}
            aria-pressed={ordem === item.id}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              ordem === item.id
                ? "bg-[#0F2A44] text-white font-medium"
                : "text-[#0F2A44]/60 hover:bg-black/5"
            }`}
          >
            {item.rotulo}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-xs text-[#0F2A44]/70 cursor-pointer">
        <input
          type="checkbox"
          checked={somenteEmAberto}
          onChange={(e) => alterar({ somenteEmAberto: e.target.checked })}
          className="rounded border-black/20"
        />
        Somente com saldo em aberto
      </label>
    </div>
  );
}
