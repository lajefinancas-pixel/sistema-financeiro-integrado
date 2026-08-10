import React from "react";
import {
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  History,
  ListChecks,
  MessageSquare,
  Paperclip,
  Tag,
  UserRound,
} from "lucide-react";
import { Alerta, ModalShell } from "../equipe/comuns";
import { BadgePrioridade, BadgeStatus } from "./badges";
import PainelAnexos from "./PainelAnexos";
import PainelChecklist from "./PainelChecklist";
import PainelComentarios from "./PainelComentarios";
import PainelHistorico from "./PainelHistorico";
import {
  categoriaLabel,
  concluirTarefa,
  formatarData,
  formatarDataHora,
  formatarHora,
  statusVisual,
  textoPrazo,
} from "../../lib/tarefas";

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

const ABAS = [
  { id: "checklist", label: "Checklist", icone: ListChecks },
  { id: "comentarios", label: "Comentários", icone: MessageSquare },
  { id: "anexos", label: "Anexos", icone: Paperclip },
  { id: "historico", label: "Histórico", icone: History },
];

/**
 * Detalhe da tarefa: os dados do cadastro (como já eram exibidos) mais o
 * checklist de etapas, os comentários, os anexos e a linha do tempo.
 *
 * Editar conteúdo e concluir seguem a mesma regra da política de update da
 * tabela: permissão de edição no módulo ou ser a responsável pela tarefa.
 */
export default function ModalDetalheTarefa({ tarefa, usuarioLogado, permissao, onFechar, onAtualizada }) {
  const [atual, setAtual] = React.useState(tarefa);
  const [aba, setAba] = React.useState("checklist");
  const [recargaHistorico, setRecargaHistorico] = React.useState(0);
  const [confirmando, setConfirmando] = React.useState(false);
  const [observacao, setObservacao] = React.useState("");
  const [concluindo, setConcluindo] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const [aviso, setAviso] = React.useState(null);

  React.useEffect(() => {
    setAtual(tarefa);
  }, [tarefa]);

  const hora = formatarHora(atual.horario_limite);
  const prazoAviso = textoPrazo(atual);

  const podeEditar =
    permissao?.pode_editar === true ||
    (Boolean(usuarioLogado?.id) && atual.responsavel_id === usuarioLogado?.id);
  const podeExcluir = permissao?.pode_excluir === true;
  const concluida = atual.status === "concluida";

  async function concluir() {
    setConcluindo(true);
    setErro(null);
    try {
      const { tarefa: atualizada, avisoHistorico } = await concluirTarefa(atual, usuarioLogado?.id, observacao);
      setAtual(atualizada);
      setConfirmando(false);
      setObservacao("");
      setRecargaHistorico((n) => n + 1);
      setAviso(avisoHistorico ? `A tarefa foi concluída, mas o registro no histórico falhou: ${avisoHistorico}` : null);
      onAtualizada?.(atualizada);
    } catch (e) {
      setErro(e.message ?? "Não foi possível concluir a tarefa.");
    } finally {
      setConcluindo(false);
    }
  }

  const rodape = !concluida && podeEditar && (
    <div className="space-y-3">
      {confirmando ? (
        <>
          <label className="block">
            <span className="text-xs font-medium text-[#0F2A44]/70">Observação final</span>
            <span className="block text-[11px] text-[#0F2A44]/45 mb-1">
              Opcional — fica registrada na tarefa e no histórico.
            </span>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
              autoFocus
              placeholder="Ex.: conferido e enviado ao setor responsável."
              className="w-full px-3 py-2 rounded-lg border border-black/10 text-sm text-[#0F2A44] outline-none focus:border-[#0F2A44] placeholder:text-[#0F2A44]/30 resize-y bg-white"
            />
          </label>
          <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              disabled={concluindo}
              className="px-4 py-2.5 rounded-lg border border-black/10 text-sm text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={concluir}
              disabled={concluindo}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#15803D] text-white text-sm hover:bg-[#15803D]/90 disabled:opacity-40"
            >
              <Check size={16} />
              {concluindo ? "Concluindo..." : "Confirmar conclusão"}
            </button>
          </div>
        </>
      ) : (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setConfirmando(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#15803D] text-white text-sm hover:bg-[#15803D]/90"
          >
            <Check size={16} />
            Concluir tarefa
          </button>
        </div>
      )}
    </div>
  );

  return (
    <ModalShell
      titulo={atual.titulo}
      subtitulo={`Criada em ${formatarDataHora(atual.criado_em)}`}
      onFechar={onFechar}
      largura="max-w-3xl"
      rodape={rodape || undefined}
    >
      <div className="space-y-6">
        {erro && <Alerta>{erro}</Alerta>}
        {aviso && (
          <div className="bg-[#FBF4DE] border border-[#C9A227]/40 text-[#8A7526] text-sm rounded-lg px-4 py-3">
            {aviso}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <BadgeStatus status={statusVisual(atual)} />
          <BadgePrioridade prioridade={atual.prioridade} />
          {atual.status === "cancelada" && (
            <span className="text-[11px] text-[#0F2A44]/45">Status gravado: cancelada</span>
          )}
        </div>

        {concluida && (
          <div className="rounded-xl border border-[#16A34A]/25 bg-[#EAFBF0] px-4 py-3 flex items-start gap-3">
            <CheckCircle2 size={16} className="text-[#15803D] mt-0.5 shrink-0" />
            <div className="text-xs text-[#15803D] leading-relaxed">
              Concluída em {formatarDataHora(atual.concluida_em)}
              {atual.finalizador?.nome_completo ? ` por ${atual.finalizador.nome_completo}` : ""}.
              {atual.observacao_final && (
                <span className="block mt-1 text-[#15803D]/85">
                  Observação final: {atual.observacao_final}
                </span>
              )}
            </div>
          </div>
        )}

        <div>
          <div className="text-[11px] uppercase tracking-wide text-[#0F2A44]/40 mb-1.5">Descrição</div>
          {atual.descricao ? (
            <p className="text-sm text-[#0F2A44]/80 leading-relaxed whitespace-pre-wrap">{atual.descricao}</p>
          ) : (
            <p className="text-sm text-[#0F2A44]/35">Sem descrição.</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <Linha icone={UserRound} rotulo="Responsável">
            {atual.responsavel?.nome_completo ?? "Sem responsável definido"}
          </Linha>
          <Linha icone={CalendarClock} rotulo="Prazo">
            {formatarData(atual.prazo)}
            {hora && <span className="text-[#0F2A44]/55"> às {hora}</span>}
            {prazoAviso && <span className="block text-[11px] text-[#0F2A44]/45 mt-0.5">{prazoAviso}</span>}
          </Linha>
          <Linha icone={Tag} rotulo="Categoria">
            {categoriaLabel(atual.categoria)}
          </Linha>
          <Linha icone={Building2} rotulo="Secretaria relacionada">
            {atual.secretaria_relacionada || "--"}
          </Linha>
        </div>

        <div className="pt-1 text-xs text-[#0F2A44]/45 border-t border-black/5">
          <div className="mt-4">
            Criada por <strong className="font-medium text-[#0F2A44]/70">{atual.autor?.nome_completo ?? "--"}</strong>
          </div>
        </div>

        <div>
          <div className="flex gap-1 border-b border-black/5 -mx-1 px-1 overflow-x-auto">
            {ABAS.map((item) => {
              const Icone = item.icone;
              const ativa = aba === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setAba(item.id)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors ${
                    ativa
                      ? "border-[#C9A227] text-[#0F2A44] font-medium"
                      : "border-transparent text-[#0F2A44]/50 hover:text-[#0F2A44]/80"
                  }`}
                >
                  <Icone size={15} />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="pt-5">
            {aba === "checklist" && (
              <PainelChecklist tarefaId={atual.id} podeEditar={podeEditar} podeExcluir={podeExcluir} />
            )}
            {aba === "comentarios" && (
              <PainelComentarios tarefaId={atual.id} usuarioId={usuarioLogado?.id} />
            )}
            {aba === "anexos" && (
              <PainelAnexos
                tarefaId={atual.id}
                usuarioId={usuarioLogado?.id}
                podeAnexar={Boolean(usuarioLogado?.id)}
                podeExcluir={podeExcluir}
              />
            )}
            {aba === "historico" && <PainelHistorico tarefaId={atual.id} recarga={recargaHistorico} />}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
