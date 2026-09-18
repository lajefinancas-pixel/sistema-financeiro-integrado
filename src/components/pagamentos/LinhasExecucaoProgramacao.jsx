import React from "react";
import { Clock3, CreditCard } from "lucide-react";
import { formatBRL } from "../../lib/moeda";
import { contasAtribuiveis, motivoContaIndisponivel } from "../../lib/execucaoProgramacao";
import { TEXTO_SEM_REGISTRO } from "../../lib/saldoCongeladoProgramacao";

const configuracao = {
  pago: { rotulo: "Pago", classe: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  parcial: { rotulo: "Parcial", classe: "bg-amber-50 text-amber-800 border-amber-200" },
  nao_pago: { rotulo: "Não pago", classe: "bg-rose-50 text-rose-800 border-rose-200" },
  pendente: { rotulo: "Pendente", classe: "bg-slate-50 text-slate-700 border-slate-200" },
};

export function situacaoDaExecucao(item, adiado = false) {
  if (adiado || item?.situacao === "cancelado" || item?.situacao === "suspenso") return "nao_pago";
  if (item?.situacao === "pago") return "pago";
  const pago = Number(item?.valor_pago ?? 0);
  if (item?.situacao === "parcialmente_pago" || pago > 0) return "parcial";
  return "pendente";
}

export default function LinhasExecucaoProgramacao({ pagamentos, contas, contasSelecionadas, secretariaId, nomePagamento, permissoes, estruturaAusente, salvando, onDefinirConta, onPagar, onAdiar }) {
  const [filtro, setFiltro] = React.useState("todos");
  const [processando, setProcessando] = React.useState(null);
  const [resposta, setResposta] = React.useState("");
  const disponiveis = contasAtribuiveis({ contas, contasSelecionadas, secretariaId });
  const motivoConta = motivoContaIndisponivel({ podeDefinirConta: permissoes?.definir_conta_pagamento !== false, podeExecutar: permissoes?.executar_programacao !== false, estruturaAusente, contasDisponiveis: disponiveis.length, salvando });
  const situacao = (item) => situacaoDaExecucao(item);
  const visiveis = pagamentos.filter((item) => filtro === "todos" || situacao(item) === filtro);
  const contagem = pagamentos.reduce((acc, item) => ({ ...acc, [situacao(item)]: (acc[situacao(item)] || 0) + 1 }), {});

  async function pagar(item) {
    setProcessando(item.id); setResposta("");
    const resultado = await onPagar?.(item);
    setResposta(resultado?.mensagem || "");
    setProcessando(null);
  }

  return <section className="overflow-hidden rounded-xl border border-[var(--color-brand-navy)]/10 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 px-3 py-2 print:hidden">
      <div><h2 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--color-brand-navy)]"><span className="text-[#B06A3C]">2.</span> Fornecedores e execução</h2><p className="mt-0.5 text-[10px] text-[var(--color-brand-navy)]/50">Conta e decisão ficam na própria linha.</p></div>
      <div className="flex flex-wrap gap-1" aria-label="Filtrar por situação">{[["todos","Todos",pagamentos.length],["pago","Pagos",contagem.pago],["parcial","Parciais",contagem.parcial],["nao_pago","Não pagos",contagem.nao_pago],["pendente","Pendentes",contagem.pendente]].map(([id, rotulo, total]) => <button key={id} onClick={() => setFiltro(id)} className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${filtro === id ? "border-[var(--color-brand-navy)] bg-[var(--color-brand-navy)] text-white" : "border-black/10 bg-white text-[var(--color-brand-navy)]"}`}>{rotulo} {total || 0}</button>)}</div>
    </div>
    {resposta && <p role="status" className="mx-3 mt-2 rounded-lg bg-[var(--color-brand-off-white)] px-3 py-2 text-[11px] text-[var(--color-brand-navy)]">{resposta}</p>}
    <div className="divide-y divide-black/5">{visiveis.map((item) => { const estado = situacao(item); const meta = configuracao[estado]; const efetivamentePago = estado === "pago" ? Number(item.valor_a_pagar) : Number(item.valor_pago ?? 0); return <div key={item.id} className="grid gap-2 px-3 py-2.5 md:grid-cols-[minmax(12rem,1.3fr)_9rem_minmax(13rem,1fr)_auto] md:items-center">
      <div className="min-w-0"><strong className="block truncate text-[13px] text-[var(--color-brand-navy)]">{nomePagamento(item)}</strong><span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${meta.classe}`}>{meta.rotulo}</span></div>
      <div className="text-[11px] text-[var(--color-brand-navy)]/55"><span className="block">Programado <strong className="text-[var(--color-brand-navy)]">{formatBRL(item.valor_a_pagar)}</strong></span><span className="block">Pago <strong className="text-[var(--color-brand-navy)]">{formatBRL(efetivamentePago)}</strong></span></div>
      <select value={item.conta_origem_id ?? ""} onChange={(e) => onDefinirConta?.(item, e.target.value ? Number(e.target.value) : null)} disabled={motivoConta || estado === "pago"} title={motivoConta || "Conta deste pagamento"} className="w-full rounded-lg border border-black/10 bg-white px-2.5 py-2 text-xs disabled:bg-black/[0.03]"><option value="">Definir conta...</option>{disponiveis.map((conta) => <option key={conta.id} value={conta.id}>{conta.nome_conta} · {conta.saldo == null ? TEXTO_SEM_REGISTRO : formatBRL(conta.saldo)}</option>)}</select>
      <div className="flex gap-1.5 md:justify-end"><button onClick={() => pagar(item)} disabled={processando === item.id || estado === "pago" || estado === "nao_pago" || !item.conta_origem_id || permissoes?.executar_programacao === false} className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-[11px] font-bold text-white disabled:opacity-35"><CreditCard size={13}/>{processando === item.id ? "Pagando..." : "Pagar integral"}</button><button onClick={() => onAdiar?.(item, estado !== "nao_pago")} disabled={estado === "pago"} className="inline-flex items-center gap-1 rounded-lg border border-black/10 px-2.5 py-2 text-[11px] font-semibold text-[var(--color-brand-navy)] disabled:opacity-35"><Clock3 size={13}/>{estado === "nao_pago" ? "Reconsiderar" : "Não pagar / adiar"}</button></div>
    </div>; })}</div>
    {visiveis.length === 0 && <p className="px-3 py-8 text-center text-xs text-[var(--color-brand-navy)]/45">Nenhum fornecedor nesta situação.</p>}
  </section>;
}
