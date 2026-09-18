import React from "react";
import { Trash2 } from "lucide-react";
import CampoMoeda from "../CampoMoeda";

export function situacaoDaExecucao(item) {
  if (item?.situacao === "pago") return "pago";
  if (item?.situacao === "parcialmente_pago" || Number(item?.valor_pago) > 0) return "parcial";
  if (item?.situacao === "suspenso" || item?.situacao === "cancelado") return "nao_pago";
  return "pendente";
}

const OPCOES = [["pago", "Pago"], ["parcial", "Parcial"], ["nao_pago", "Não pago"], ["pendente", "Pendente"]];

export default function LinhasExecucaoProgramacao({ pagamentos, nomePagamento, podeEditar = false, salvando, onMarcar, onEditarValor, onExcluir }) {
  const [filtro, setFiltro] = React.useState("todos");
  const [parciais, setParciais] = React.useState({});
  const [processando, setProcessando] = React.useState(null);
  const situacao = (item) => situacaoDaExecucao(item);
  const visiveis = pagamentos.filter((item) => filtro === "todos" || situacao(item) === filtro);
  const contagem = pagamentos.reduce((total, item) => ({ ...total, [situacao(item)]: (total[situacao(item)] || 0) + 1 }), {});

  async function marcar(item, nova) {
    setProcessando(item.id);
    await onMarcar?.(item, nova, nova === "parcial" ? (parciais[item.id] ?? item.valor_pago ?? 0) : 0);
    setProcessando(null);
  }

  return <section className="overflow-hidden rounded-xl border border-[var(--color-brand-navy)]/10 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 px-3 py-1.5">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--color-brand-navy)]">Fornecedores da programação</h2>
      <div className="flex flex-wrap gap-1" aria-label="Filtrar por situação">{[["todos","Todos",pagamentos.length],["pago","Pagos",contagem.pago],["parcial","Parciais",contagem.parcial],["nao_pago","Não pagos",contagem.nao_pago],["pendente","Pendentes",contagem.pendente]].map(([id,rotulo,total]) => <button type="button" key={id} onClick={() => setFiltro(id)} className={`border-b-2 px-2 py-1 text-[10px] font-semibold ${filtro === id ? "border-[var(--color-brand-navy)] text-[var(--color-brand-navy)]" : "border-transparent text-[var(--color-brand-navy)]/50"}`}>{rotulo} {total || 0}</button>)}</div>
    </div>
    <div className="divide-y divide-black/5">{visiveis.map((item) => <div key={item.id} className="grid min-h-12 items-center gap-2 px-3 py-1.5 md:grid-cols-[minmax(13rem,1fr)_10rem_minmax(19rem,auto)_auto]">
      <div className="min-w-0"><strong className="block truncate text-[13px] text-[var(--color-brand-navy)]">{nomePagamento(item)}</strong>{item.fornecedores?.razao_social && <small className="block truncate text-[10px] text-[var(--color-brand-navy)]/45">{item.fornecedores.razao_social}</small>}</div>
      <CampoMoeda valor={item.valor_a_pagar} disabled={!podeEditar} onValorChange={(valor) => onEditarValor?.(item, valor)} aria-label={`Valor programado para ${nomePagamento(item)}`} className="w-full rounded-md border border-black/10 px-2 py-1 text-right text-xs font-semibold disabled:bg-transparent" />
      <div className="flex flex-wrap items-center gap-1">{OPCOES.map(([id, rotulo]) => <button type="button" key={id} disabled={!podeEditar || salvando || processando === item.id} onClick={() => marcar(item,id)} className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${situacao(item) === id ? "border-[var(--color-brand-navy)] bg-[var(--color-brand-navy)] text-white" : "border-black/10 text-[var(--color-brand-navy)]/65"}`}>{rotulo}</button>)}{situacao(item) === "parcial" && <CampoMoeda valor={parciais[item.id] ?? item.valor_pago ?? 0} onValorChange={(valor)=>setParciais((atual)=>({...atual,[item.id]:valor}))} onBlur={()=>marcar(item,"parcial")} aria-label={`Valor parcial de ${nomePagamento(item)}`} className="w-28 rounded-md border border-black/10 px-2 py-1 text-right text-[10px]" />}</div>
      <button type="button" onClick={() => onExcluir?.(item)} disabled={!podeEditar} className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-30" aria-label={`Excluir ${nomePagamento(item)}`}><Trash2 size={14}/></button>
    </div>)}</div>
    {visiveis.length === 0 && <p className="px-3 py-8 text-center text-xs text-[var(--color-brand-navy)]/45">Nenhum fornecedor nesta situação.</p>}
  </section>;
}
