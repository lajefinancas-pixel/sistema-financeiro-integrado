import React from "react";
import { Building2, CalendarClock, MessageSquare, Tag, UserRound } from "lucide-react";
import { ModalShell } from "../equipe/comuns";
import { BadgePrioridade, BadgeStatus } from "./badges";
import { categoriaLabel, formatarData, formatarDataHora, formatarHora, statusVisual, textoPrazo } from "../../lib/tarefas";

function Linha({ icone: Icone, rotulo, children }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-[#F5F3EF] flex items-center justify-center shrink-0">
        <Icone size={15} className="text-[#0F2A44]/45" />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-[#0F2A44]/40">{rotulo}</div>
        <div className="text-sm text-[#0F2A44] mt-0.5 break-words">{children}</div>
      </div>
    </div>
  );
}

/**
 * Visão somente leitura da tarefa. Comentários e anexos entram numa etapa
 * seguinte; por ora o modal mostra os dados do cadastro e o aviso disso.
 */
export default function ModalDetalheTarefa({ tarefa, onFechar }) {
  const hora = formatarHora(tarefa.horario_limite);
  const aviso = textoPrazo(tarefa);

  return (
    <ModalShell titulo={tarefa.titulo} subtitulo={`Criada em ${formatarDataHora(tarefa.criado_em)}`} onFechar={onFechar}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <BadgeStatus status={statusVisual(tarefa)} />
          <BadgePrioridade prioridade={tarefa.prioridade} />
          {tarefa.status === "cancelada" && (
            <span className="text-[11px] text-[#0F2A44]/45">Status gravado: cancelada</span>
          )}
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide text-[#0F2A44]/40 mb-1.5">Descrição</div>
          {tarefa.descricao ? (
            <p className="text-sm text-[#0F2A44]/80 leading-relaxed whitespace-pre-wrap">{tarefa.descricao}</p>
          ) : (
            <p className="text-sm text-[#0F2A44]/35">Sem descrição.</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <Linha icone={UserRound} rotulo="Responsável">
            {tarefa.responsavel?.nome_completo ?? "Sem responsável definido"}
          </Linha>
          <Linha icone={CalendarClock} rotulo="Prazo">
            {formatarData(tarefa.prazo)}
            {hora && <span className="text-[#0F2A44]/55"> às {hora}</span>}
            {aviso && <span className="block text-[11px] text-[#0F2A44]/45 mt-0.5">{aviso}</span>}
          </Linha>
          <Linha icone={Tag} rotulo="Categoria">
            {categoriaLabel(tarefa.categoria)}
          </Linha>
          <Linha icone={Building2} rotulo="Secretaria relacionada">
            {tarefa.secretaria_relacionada || "--"}
          </Linha>
        </div>

        <div className="pt-1 text-xs text-[#0F2A44]/45 border-t border-black/5">
          <div className="mt-4">
            Criada por <strong className="font-medium text-[#0F2A44]/70">{tarefa.autor?.nome_completo ?? "--"}</strong>
            {tarefa.concluida_em && ` — concluída em ${formatarDataHora(tarefa.concluida_em)}`}
          </div>
        </div>

        <div className="rounded-xl border border-dashed border-[#C9A227]/45 bg-[#FBF4DE]/60 px-4 py-3 flex items-start gap-3">
          <MessageSquare size={16} className="text-[#8A7526] mt-0.5 shrink-0" />
          <p className="text-xs text-[#8A7526] leading-relaxed">
            Comentários, anexos e mudança de status entram na próxima etapa desta tela.
          </p>
        </div>
      </div>
    </ModalShell>
  );
}
