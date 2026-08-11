import React from "react";
import { Building2, User } from "lucide-react";
import {
  diaDaMovimentacao,
  formatarDataHora,
  formatarDia,
  moduloLabel,
  tipoInfo,
} from "../../lib/historicoMovimentacoes";

/** Movimentações agrupadas por dia, na ordem em que já chegaram (mais recentes primeiro). */
function agruparPorDia(movimentacoes) {
  const grupos = [];
  movimentacoes.forEach((m) => {
    const dia = diaDaMovimentacao(m.instante);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.dia === dia) ultimo.itens.push(m);
    else grupos.push({ dia, itens: [m] });
  });
  return grupos;
}

/**
 * Linha do tempo das movimentações do sistema, do mais recente para o mais
 * antigo, agrupada por dia. Cada item mostra o tipo de movimentação, o módulo,
 * quem fez, quando e o registro afetado.
 */
export default function LinhaDoTempoHistorico({ movimentacoes }) {
  const grupos = agruparPorDia(movimentacoes);

  return (
    <div className="space-y-6">
      {grupos.map((grupo) => (
        <div key={grupo.dia}>
          <div className="text-[11px] uppercase tracking-wide text-[#0F2A44]/40 font-medium mb-2 capitalize">
            {formatarDia(grupo.dia)}
          </div>

          <div className="bg-white rounded-2xl border border-black/5 shadow-sm divide-y divide-black/5">
            {grupo.itens.map((m) => {
              const info = tipoInfo(m.tipo);
              return (
                <div key={m.id} className="flex gap-3 px-4 py-3.5">
                  <span
                    className="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: info.cor }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap"
                        style={{ color: info.cor, backgroundColor: info.bg }}
                      >
                        {info.label}
                      </span>
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#E7EDF5] text-[#0F2A44] whitespace-nowrap">
                        {moduloLabel(m.modulo)}
                      </span>
                      <span className="text-[11px] text-[#0F2A44]/45 tabular-nums">
                        {formatarDataHora(m.instante)}
                      </span>
                    </div>

                    <div className="text-sm text-[#0F2A44] mt-1.5 break-words">{m.registro}</div>
                    {m.detalhe && (
                      <div className="text-xs text-[#0F2A44]/55 mt-0.5 break-words">{m.detalhe}</div>
                    )}

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-[11px] text-[#0F2A44]/50">
                      <span className="inline-flex items-center gap-1">
                        <User size={12} /> {m.usuario}
                      </span>
                      {m.secretaria && (
                        <span className="inline-flex items-center gap-1">
                          <Building2 size={12} /> {m.secretaria}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
