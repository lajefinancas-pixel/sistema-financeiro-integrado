import React from "react";
import { formatBRL } from "../../lib/moeda";
import { situacaoDaMarcacao } from "../../lib/execucaoProgramacao";

export const situacaoDaExecucao = situacaoDaMarcacao;

const OPCOES = [["pago", "PAGO"], ["nao_pago", "NÃO PAGO"]];

export default function LinhasExecucaoProgramacao({ pagamentos, nomePagamento, podeMarcar = false, salvando, onMarcar }) {
  const [filtro, setFiltro] = React.useState("todos");
  const [processando, setProcessando] = React.useState(null);
  const situacao = (item) => situacaoDaExecucao(item);
  const visiveis = pagamentos.filter((item) => filtro === "todos" || situacao(item) === filtro);
  const contagem = pagamentos.reduce((total, item) => ({ ...total, [situacao(item)]: (total[situacao(item)] || 0) + 1 }), {});

  async function marcar(item, nova) {
    setProcessando(item.id);
    await onMarcar?.(item, nova);
    setProcessando(null);
  }

  return <>
    <div className="flex flex-wrap gap-1 border-b border-black/5 px-3 py-1.5 print:hidden" aria-label="Filtrar por situação">{[["todos","Todos",pagamentos.length],["pago","Pagos",contagem.pago],["nao_pago","Não pagos",contagem.nao_pago],["pendente","Pendentes",contagem.pendente]].map(([id,rotulo,total]) => <button type="button" key={id} onClick={() => setFiltro(id)} className={`border-b-2 px-2 py-1 text-[10px] font-semibold ${filtro === id ? "border-[var(--color-brand-navy)] text-[var(--color-brand-navy)]" : "border-transparent text-[var(--color-brand-navy)]/50"}`}>{rotulo} {total || 0}</button>)}</div>
    <div className="divide-y divide-black/5">{visiveis.map((item) => <div key={item.id} className="grid min-h-12 items-center gap-2 px-3 py-1.5 sm:grid-cols-[minmax(12rem,1fr)_9rem_auto]">
      <div className="min-w-0"><strong className="block truncate text-[13px] text-[var(--color-brand-navy)]">{nomePagamento(item)}</strong>{item.fornecedores?.razao_social && <small className="block truncate text-[10px] text-[var(--color-brand-navy)]/45">{item.fornecedores.razao_social}</small>}</div>
      <strong className="text-right text-[13px] tabular-nums text-[var(--color-brand-navy)]">{formatBRL(item.valor_a_pagar)}</strong>
      <div className="flex justify-end gap-1">{OPCOES.map(([id, rotulo]) => <button type="button" key={id} disabled={!podeMarcar || salvando || processando === item.id} onClick={() => marcar(item,id)} className={`rounded-md border px-2.5 py-1 text-[10px] font-bold ${situacao(item) === id ? "border-[var(--color-brand-navy)] bg-[var(--color-brand-navy)] text-white" : "border-black/10 text-[var(--color-brand-navy)]/65"}`}>{rotulo}</button>)}</div>
    </div>)}</div>
    {visiveis.length === 0 && <p className="px-3 py-8 text-center text-xs text-[var(--color-brand-navy)]/45">Nenhum fornecedor nesta situação.</p>}
  </>;
}
