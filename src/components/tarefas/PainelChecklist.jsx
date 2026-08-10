import React from "react";
import { Check, ListChecks, Plus, Trash2 } from "lucide-react";
import { Alerta } from "../equipe/comuns";
import {
  criarSubtarefa,
  excluirSubtarefa,
  listarSubtarefas,
  marcarSubtarefa,
  progressoChecklist,
} from "../../lib/tarefas";

/**
 * Checklist da tarefa (tabela "subtarefas"): marca etapas, adiciona novas e
 * mostra o quanto já foi feito. Os botões seguem as permissões do módulo.
 */
export default function PainelChecklist({ tarefaId, podeEditar, podeExcluir }) {
  const [itens, setItens] = React.useState([]);
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [novo, setNovo] = React.useState("");
  const [salvando, setSalvando] = React.useState(false);

  React.useEffect(() => {
    let ativo = true;
    setCarregando(true);
    listarSubtarefas(tarefaId)
      .then((lista) => ativo && setItens(lista))
      .catch((e) => ativo && setErro(e.message ?? "Não foi possível carregar o checklist."))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [tarefaId]);

  const { total, feitos, percentual } = progressoChecklist(itens);

  async function alternar(item) {
    setErro(null);
    // Atualiza na tela primeiro; se o banco recusar, o valor volta ao anterior.
    setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, concluida: !i.concluida } : i)));
    try {
      await marcarSubtarefa(item.id, !item.concluida);
    } catch (e) {
      setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, concluida: item.concluida } : i)));
      setErro(e.message ?? "Não foi possível atualizar a etapa.");
    }
  }

  async function adicionar(evento) {
    evento.preventDefault();
    if (!novo.trim() || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const item = await criarSubtarefa(tarefaId, novo, itens);
      setItens((atual) => [...atual, item]);
      setNovo("");
    } catch (e) {
      setErro(e.message ?? "Não foi possível adicionar a etapa.");
    } finally {
      setSalvando(false);
    }
  }

  async function remover(item) {
    setErro(null);
    try {
      await excluirSubtarefa(item.id);
      setItens((atual) => atual.filter((i) => i.id !== item.id));
    } catch (e) {
      setErro(e.message ?? "Não foi possível excluir a etapa.");
    }
  }

  if (carregando) return <div className="text-sm text-[#0F2A44]/45">Carregando checklist...</div>;

  return (
    <div className="space-y-4">
      {erro && <Alerta>{erro}</Alerta>}

      <div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-medium text-[#0F2A44]/70">
            {total === 0
              ? "Nenhuma etapa cadastrada"
              : `${feitos} de ${total} ${total === 1 ? "etapa concluída" : "etapas concluídas"} — ${percentual}%`}
          </span>
          {total > 0 && <span className="text-[#0F2A44]/40">{percentual}%</span>}
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-black/[0.06] overflow-hidden">
          <div
            className="h-full rounded-full bg-[#C9A227] transition-[width] duration-300"
            style={{ width: `${percentual}%` }}
          />
        </div>
      </div>

      {total === 0 ? (
        <div className="rounded-xl border border-dashed border-black/10 py-7 text-center">
          <ListChecks size={22} className="text-[#0F2A44]/20 mx-auto mb-2" />
          <p className="text-xs text-[#0F2A44]/40">
            {podeEditar ? "Quebre a tarefa em etapas para acompanhar o andamento." : "Sem etapas cadastradas."}
          </p>
        </div>
      ) : (
        <ul className="space-y-1">
          {itens.map((item) => (
            <li key={item.id} className="flex items-start gap-2.5 group rounded-lg px-2 py-1.5 hover:bg-black/[0.02]">
              <button
                type="button"
                disabled={!podeEditar}
                onClick={() => alternar(item)}
                aria-pressed={Boolean(item.concluida)}
                title={podeEditar ? (item.concluida ? "Desmarcar etapa" : "Marcar como concluída") : undefined}
                className={`w-[18px] h-[18px] mt-0.5 rounded-[5px] border flex items-center justify-center shrink-0 transition-colors ${
                  item.concluida
                    ? "bg-[#16A34A] border-[#16A34A] text-white"
                    : "border-black/20 text-transparent hover:border-[#0F2A44]/50"
                } ${podeEditar ? "cursor-pointer" : "cursor-default opacity-70"}`}
              >
                <Check size={12} strokeWidth={3} />
              </button>

              <span
                className={`text-sm leading-relaxed flex-1 break-words ${
                  item.concluida ? "text-[#0F2A44]/40 line-through" : "text-[#0F2A44]/85"
                }`}
              >
                {item.descricao}
              </span>

              {podeExcluir && (
                <button
                  type="button"
                  onClick={() => remover(item)}
                  title="Excluir etapa"
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-[#0F2A44]/25 hover:text-[#DC2626] hover:bg-black/5 opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {podeEditar && (
        <form onSubmit={adicionar} className="flex gap-2">
          <input
            type="text"
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            placeholder="Adicionar etapa..."
            maxLength={240}
            className="flex-1 px-3 py-2 rounded-lg border border-black/10 text-sm text-[#0F2A44] outline-none focus:border-[#0F2A44] placeholder:text-[#0F2A44]/30"
          />
          <button
            type="submit"
            disabled={!novo.trim() || salvando}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0F2A44] text-white text-sm hover:bg-[#0F2A44]/90 disabled:opacity-40 whitespace-nowrap"
          >
            <Plus size={15} />
            {salvando ? "Salvando..." : "Adicionar"}
          </button>
        </form>
      )}
    </div>
  );
}
