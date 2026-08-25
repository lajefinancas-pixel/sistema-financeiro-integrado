import React from "react";
import { AlertTriangle, X } from "lucide-react";
import CampoMoeda from "../CampoMoeda";
import { formatBRL, paraNumeroMoeda } from "../../lib/moeda";
import { registrarBaixa } from "../../lib/baixasPagamentos";
import { resumoBaixas } from "../../lib/regrasBaixas";
import { mensagemAmigavel } from "../../lib/erros";

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function ModalBaixaPagamento({ pagamento = null, fornecedores = [], contas = [], contaSugeridaId = "", baixas = [], onFechar, onConcluida }) {
  const resumo = resumoBaixas(pagamento?.valor_a_pagar ?? 0, baixas);
  const chaveRascunho = `sfi.baixa.pendente.${pagamento?.id ?? "avulsa"}`;
  const rascunho = React.useMemo(() => {
    try { return JSON.parse(window.sessionStorage.getItem(chaveRascunho) || "null"); } catch { return null; }
  }, [chaveRascunho]);
  const chaveInicial = React.useRef(rascunho?.chaveIdempotencia || crypto.randomUUID());
  const [form, setForm] = React.useState(rascunho?.form || {
    fornecedorId: pagamento?.fornecedor_id ? String(pagamento.fornecedor_id) : "",
    valor: pagamento ? resumo.saldoEmAberto : "",
    dataPagamento: hojeISO(),
    contaId: contaSugeridaId || "",
    documento: "",
    observacao: "",
  });
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState(null);
  const conta = contas.find((item) => String(item.id) === String(form.contaId));
  const valor = paraNumeroMoeda(form.valor);
  const saldoConta = paraNumeroMoeda(conta?.saldoHoje ?? conta?.saldo ?? 0);
  const alertaSaldo = form.contaId && valor > saldoConta;

  React.useEffect(() => {
    try { window.sessionStorage.setItem(chaveRascunho, JSON.stringify({ chaveIdempotencia: chaveInicial.current, form })); } catch { /* armazenamento indisponível */ }
  }, [chaveRascunho, form]);

  async function confirmar(evento) {
    evento.preventDefault();
    if (!form.fornecedorId) return setErro("Fornecedor obrigatório.");
    if (valor <= 0) return setErro("O valor da baixa deve ser maior que zero.");
    if (!form.dataPagamento || form.dataPagamento > hojeISO()) return setErro("A data do pagamento não pode ser futura.");
    if (!form.contaId) return setErro("Conta bancária obrigatória.");
    if (pagamento && valor > resumo.saldoEmAberto + 0.005) return setErro(`O valor informado supera o saldo em aberto disponível de ${formatBRL(resumo.saldoEmAberto)}.`);
    setSalvando(true);
    setErro(null);
    try {
      await registrarBaixa({
        ...form,
        valor,
        pagamentoId: pagamento?.id ?? null,
        chaveIdempotencia: chaveInicial.current,
      });
      await onConcluida?.();
      try { window.sessionStorage.removeItem(chaveRascunho); } catch { /* armazenamento indisponível */ }
      onFechar();
    } catch (falha) {
      console.error("[Baixas] Erro do Supabase ao registrar baixa.", falha);
      setErro(mensagemAmigavel(falha, "Não foi possível registrar a baixa."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true">
      <form onSubmit={confirmar} className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-black/5 px-5 py-4">
          <div><h2 className="font-semibold text-[#0F2A44]">{pagamento ? "Registrar baixa do pagamento" : "Registrar baixa avulsa"}</h2><p className="mt-1 text-xs text-[#0F2A44]/55">A confirmação debita a conta escolhida. A programação, por si só, não movimenta saldo.</p></div>
          <button type="button" onClick={onFechar} className="rounded-lg p-2 text-[#0F2A44]/50 hover:bg-black/5"><X size={18}/></button>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {pagamento && <div className="sm:col-span-2 grid grid-cols-3 gap-3 rounded-xl bg-[#F4F7F9] p-3 text-xs"><div>Valor total<strong className="block text-sm text-[#0F2A44]">{formatBRL(resumo.valorTotal)}</strong></div><div>Total baixado<strong className="block text-sm text-[#0F2A44]">{formatBRL(resumo.totalBaixado)}</strong></div><div>Saldo em aberto<strong className="block text-sm text-[#0F2A44]">{formatBRL(resumo.saldoEmAberto)}</strong></div></div>}
          <label className="sm:col-span-2 text-xs font-medium text-[#0F2A44]/70">Fornecedor<select value={form.fornecedorId} disabled={Boolean(pagamento)} onChange={(e)=>setForm({...form,fornecedorId:e.target.value})} className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-sm disabled:bg-black/[0.03]"><option value="">Selecione...</option>{fornecedores.map((item)=><option key={item.id} value={item.id}>{item.razao_social}</option>)}</select></label>
          <label className="text-xs font-medium text-[#0F2A44]/70">Valor pago nesta baixa<CampoMoeda valor={form.valor} onValorChange={(valorNovo)=>setForm({...form,valor:valorNovo})} className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"/></label>
          <label className="text-xs font-medium text-[#0F2A44]/70">Data real do pagamento<input type="date" max={hojeISO()} value={form.dataPagamento} onChange={(e)=>setForm({...form,dataPagamento:e.target.value})} className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"/></label>
          <label className="sm:col-span-2 text-xs font-medium text-[#0F2A44]/70">Conta bancária<select value={form.contaId} onChange={(e)=>setForm({...form,contaId:e.target.value})} className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-sm"><option value="">Selecione...</option>{contas.map((item)=><option key={item.id} value={item.id}>{item.nome_conta} · {item.banco} · {item.numero_conta || "sem número"} · saldo {formatBRL(item.saldoHoje ?? item.saldo)}</option>)}</select></label>
          {alertaSaldo && <div className="sm:col-span-2 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"><AlertTriangle size={15} className="shrink-0"/>O valor da baixa é maior que o saldo atual da conta ({formatBRL(saldoConta)}). A confirmação continua permitida.</div>}
          <label className="text-xs font-medium text-[#0F2A44]/70">Documento/comprovante<input value={form.documento} onChange={(e)=>setForm({...form,documento:e.target.value})} className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"/></label>
          <label className="text-xs font-medium text-[#0F2A44]/70">Observação<input value={form.observacao} onChange={(e)=>setForm({...form,observacao:e.target.value})} className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm"/></label>
          {erro && <div className="sm:col-span-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-black/5 px-5 py-4"><button type="button" onClick={onFechar} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button><button type="submit" disabled={salvando} className="rounded-lg bg-[#0F2A44] px-4 py-2 text-sm text-white disabled:opacity-50">{salvando ? "Confirmando..." : "Confirmar baixa"}</button></div>
      </form>
    </div>
  );
}
