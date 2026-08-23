import React from "react";
import { ChevronRight, ClipboardList } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { BadgePrioridade, BadgeStatus } from "../tarefas/badges";
import { formatarData, formatarHora, statusVisual, textoPrazo } from "../../lib/tarefas";
import { LIMITE_LISTA } from "../../lib/painelPessoal";

/**
 * Seção compacta "Minhas tarefas" do Painel Principal.
 *
 * Mostra só as tarefas em que a pessoa logada é a responsável, no formato
 * Tarefa | Prazo | Prioridade | Status, cortada nas mais urgentes. A tela do
 * módulo continua sendo /tarefas: aqui não há filtro, edição nem abertura de
 * tarefa — é resumo e caminho.
 *
 * Quem não tem permissão de visualizar tarefas não vê a seção.
 */
export default function CardMinhasTarefas({ tarefas, resumo, visivel }) {
  const navigate = useNavigate();
  if (!visivel) return null;

  const lista = (tarefas ?? []).slice(0, LIMITE_LISTA);
  const restantes = (tarefas ?? []).length - lista.length;

  return (
    <div className="col-span-2 bg-white rounded-2xl border border-black/5 shadow-sm p-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="text-base font-semibold">Minhas Tarefas</h2>
        <button
          type="button"
          onClick={() => navigate("/tarefas")}
          className="flex items-center gap-1 text-xs text-[#0F2A44]/50 hover:text-[#0F2A44]"
        >
          Ver todas
          <ChevronRight size={13} className="text-[#0F2A44]/40" />
        </button>
      </div>

      <div className="text-xs text-[#0F2A44]/60 mb-3">
        <span className="font-medium text-[#0F2A44]">{resumo.pendentes}</span>{" "}
        {resumo.pendentes === 1 ? "pendente" : "pendentes"},{" "}
        <span style={{ color: resumo.venceHoje > 0 ? "#EA9A1E" : undefined }}>
          {resumo.venceHoje} {resumo.venceHoje === 1 ? "vence" : "vencem"} hoje
        </span>
        ,{" "}
        <span style={{ color: resumo.atrasadas > 0 ? "#DC2626" : undefined }}>
          {resumo.atrasadas} {resumo.atrasadas === 1 ? "atrasada" : "atrasadas"}
        </span>
      </div>

      {lista.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-[#0F2A44]/40 py-2">
          <ClipboardList size={15} className="text-[#0F2A44]/20" />
          Nenhuma tarefa atribuída a você no momento.
        </div>
      ) : (
        <>
          <div className="divide-y divide-black/5 border-t border-black/5">
            {lista.map((t) => {
              const hora = formatarHora(t.horario_limite);
              const aviso = textoPrazo(t);
              return (
                <div key={t.id} className="flex items-center gap-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[#0F2A44] truncate">{t.titulo}</div>
                    {aviso && <div className="text-[11px] text-[#0F2A44]/40">{aviso}</div>}
                  </div>
                  <div className="text-xs text-[#0F2A44]/60 whitespace-nowrap w-[110px] text-right">
                    {formatarData(t.prazo)}
                    {hora && <span className="text-[#0F2A44]/40"> {hora}</span>}
                  </div>
                  <BadgePrioridade prioridade={t.prioridade} />
                  <BadgeStatus status={statusVisual(t)} />
                </div>
              );
            })}
          </div>
          {restantes > 0 && (
            <div className="text-[11px] text-[#0F2A44]/40 pt-2.5">
              e mais {restantes} {restantes === 1 ? "tarefa" : "tarefas"} em /tarefas
            </div>
          )}
        </>
      )}
    </div>
  );
}
