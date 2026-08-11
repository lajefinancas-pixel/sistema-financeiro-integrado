import React from "react";
import { Building2, ChevronDown, ChevronUp, User } from "lucide-react";
import ComparacaoAntesDepois from "./ComparacaoAntesDepois";
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
 * O que o botão de expandir promete, conforme o que a movimentação guardou:
 * cadastro só tem o lado "Depois", exclusão só tem o lado "Antes" e a alteração
 * tem os dois.
 */
function textoDoBotao(mudancas) {
  const quantidade = `${mudancas.length} ${mudancas.length === 1 ? "campo" : "campos"}`;
  if (mudancas.every((m) => !m.tinhaAntes)) return `Ver os dados registrados (${quantidade})`;
  if (mudancas.every((m) => !m.temDepois)) return `Ver os dados anteriores (${quantidade})`;
  return `Ver o que mudou (${quantidade})`;
}

/**
 * Linha do tempo das movimentações do sistema, do mais recente para o mais
 * antigo, agrupada por dia. Cada item mostra o tipo de movimentação, o módulo,
 * quem fez, quando e o registro afetado.
 *
 * Quando a movimentação guardou o estado do registro antes e depois da ação, o
 * item pode ser expandido para mostrar a comparação campo a campo.
 */
export default function LinhaDoTempoHistorico({ movimentacoes }) {
  const grupos = agruparPorDia(movimentacoes);
  const [expandidos, setExpandidos] = React.useState(() => new Set());

  function alternar(id) {
    setExpandidos((atuais) => {
      const proximos = new Set(atuais);
      if (proximos.has(id)) proximos.delete(id);
      else proximos.add(id);
      return proximos;
    });
  }

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
              const mudancas = m.mudancas ?? [];
              const temComparacao = mudancas.length > 0;
              const aberto = expandidos.has(m.id);
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

                    {/* A comparação só é oferecida quando a movimentação guardou o
                        estado do registro; sem isso não há o que abrir. */}
                    {temComparacao && (
                      <>
                        <button
                          type="button"
                          onClick={() => alternar(m.id)}
                          aria-expanded={aberto}
                          className="mt-2 inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg border border-black/10 text-[#0F2A44]/65 hover:bg-black/5"
                        >
                          {aberto ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          {aberto ? "Ocultar a comparação" : textoDoBotao(mudancas)}
                        </button>
                        {aberto && <ComparacaoAntesDepois mudancas={mudancas} />}
                      </>
                    )}
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
