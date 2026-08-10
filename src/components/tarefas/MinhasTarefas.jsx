import React from "react";
import { CalendarClock, ClipboardList, Share2, Star } from "lucide-react";
import { BadgePrioridade, BadgeStatus } from "./badges";
import {
  GRUPOS_MINHAS,
  agruparMinhasTarefas,
  categoriaLabel,
  formatarData,
  formatarHora,
  statusVisual,
  textoPrazo,
} from "../../lib/tarefas";

function CartaoTarefa({ tarefa, compartilhada, onAbrir }) {
  const hora = formatarHora(tarefa.horario_limite);
  const aviso = textoPrazo(tarefa);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onAbrir(tarefa)}
      onKeyDown={(evento) => {
        if (evento.key === "Enter") onAbrir(tarefa);
      }}
      className="bg-white rounded-xl border border-black/5 shadow-sm p-3.5 cursor-pointer hover:border-[#C9A227]/60 outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227]/60"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium text-[#0F2A44] leading-snug break-words min-w-0">
          {tarefa.titulo}
        </div>
        <BadgePrioridade prioridade={tarefa.prioridade} />
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-2">
        {tarefa.importante && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#8A6100] bg-[#FEF6DF] px-2 py-0.5 rounded-full">
            <Star size={11} />
            Importante
          </span>
        )}
        {compartilhada && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#7C3AED] bg-[#F3EDFF] px-2 py-0.5 rounded-full">
            <Share2 size={11} />
            Compartilhada
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-black/5">
        <BadgeStatus status={statusVisual(tarefa)} />
        <span className="flex items-center gap-1 text-[11px] text-[#0F2A44]/55">
          <CalendarClock size={12} className="text-[#0F2A44]/30" />
          {formatarData(tarefa.prazo)}
          {hora ? ` às ${hora}` : ""}
        </span>
        <span className="text-[11px] text-[#0F2A44]/40">{categoriaLabel(tarefa.categoria)}</span>
        {aviso && <span className="text-[11px] text-[#0F2A44]/40">{aviso}</span>}
      </div>
    </div>
  );
}

/**
 * Aba "Minhas tarefas": só o que é da pessoa logada — como responsável ou por
 * compartilhamento (tabela tarefas_compartilhadas) — dividido em faixas de
 * acompanhamento (Para hoje, Próximas, Em andamento, Aguardando, Atrasadas e
 * Concluídas). Cada tarefa aparece em uma faixa só.
 */
export default function MinhasTarefas({ tarefas, usuarioId, idsCompartilhadas, onAbrir }) {
  const grupos = React.useMemo(() => agruparMinhasTarefas(tarefas), [tarefas]);
  const total = GRUPOS_MINHAS.reduce((soma, g) => soma + grupos[g.id].length, 0);

  if (total === 0) {
    return (
      <div className="bg-white rounded-2xl border border-dashed border-black/10 p-10 text-center">
        <ClipboardList size={26} className="text-[#0F2A44]/20 mx-auto mb-3" />
        <div className="text-sm text-[#0F2A44]/40">
          Nenhuma tarefa atribuída a você nem compartilhada com você por enquanto.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {GRUPOS_MINHAS.map((grupo) => {
        const lista = grupos[grupo.id];
        return (
          <section key={grupo.id}>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: grupo.cor }} />
              <h2 className="text-[11px] uppercase tracking-[0.14em] font-semibold text-[#0F2A44]/60">
                {grupo.titulo}
              </h2>
              <span className="text-[11px] font-medium text-[#0F2A44]/35">{lista.length}</span>
            </div>

            {lista.length === 0 ? (
              <div className="rounded-xl border border-dashed border-black/10 py-4 text-center text-[11px] text-[#0F2A44]/30">
                Nada aqui.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {lista.map((tarefa) => (
                  <CartaoTarefa
                    key={tarefa.id}
                    tarefa={tarefa}
                    compartilhada={tarefa.responsavel_id !== usuarioId && idsCompartilhadas.has(tarefa.id)}
                    onAbrir={onAbrir}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
