import React from "react";
import { CalendarDays, CalendarRange, CheckCircle2, Wallet } from "lucide-react";
import { ATALHOS, atalhoAtivo } from "../../lib/historicoMovimentacoes";

const ICONES = {
  hoje: CalendarDays,
  semana: CalendarRange,
  saldos: Wallet,
  tarefas: CheckCircle2,
};

/**
 * Cards de acesso rápido do topo do Histórico.
 *
 * Cada card é um atalho para um recorte da linha do tempo: ao clicar, os filtros
 * abaixo são preenchidos com o recorte e a consulta acontece na hora — nada é
 * consultado por fora da área de filtros. O card fica destacado enquanto o
 * recorte dele é o que está valendo.
 */
export default function CardsAtalhoHistorico({ aplicados, contagens = {}, onSelecionar }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      {ATALHOS.map((atalho) => {
        const Icone = ICONES[atalho.icone] ?? CalendarDays;
        const ativo = atalhoAtivo(atalho, aplicados);
        const total = contagens[atalho.chave];

        return (
          <button
            key={atalho.chave}
            type="button"
            onClick={() => onSelecionar(atalho)}
            aria-pressed={ativo}
            className={`text-left rounded-2xl border p-4 transition-colors ${
              ativo
                ? "bg-[#0F2A44] border-[#0F2A44] text-white"
                : "bg-white border-black/5 shadow-sm hover:bg-black/[0.02]"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <Icone size={18} className={ativo ? "text-[#C9A227]" : "text-[#0F2A44]/40"} />
              <span
                className={`text-lg font-semibold tabular-nums ${ativo ? "text-white" : "text-[#0F2A44]"}`}
              >
                {total === undefined ? "--" : total === null ? "" : total}
              </span>
            </div>
            <div className={`text-sm font-medium mt-2 ${ativo ? "text-white" : "text-[#0F2A44]"}`}>
              {atalho.titulo}
            </div>
            <div className={`text-[11px] mt-0.5 ${ativo ? "text-white/70" : "text-[#0F2A44]/50"}`}>
              {atalho.descricao}
            </div>
          </button>
        );
      })}
    </div>
  );
}
