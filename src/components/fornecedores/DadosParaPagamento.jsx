import React from "react";
import { CreditCard, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { excluirFormaPagamento, listarFormasPagamento, salvarFormaPagamento } from "../../lib/dadosPagamentoFornecedor";

const VAZIO = { kind: "pix", pixKeyType: "cnpj", pixKey: "", bankName: "", bankCode: "", agency: "", account: "", accountDigit: "", accountType: "corrente", holderName: "", holderDocument: "", isPrimary: false };

export default function DadosParaPagamento({ fornecedorId, permissoes = {}, onChange }) {
  const [formas, setFormas] = React.useState([]);
  const [form, setForm] = React.useState(null);
  const [erro, setErro] = React.useState(null);
  const [salvando, setSalvando] = React.useState(false);
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const carregar = React.useCallback(async () => {
    try {
      const lista = await listarFormasPagamento(fornecedorId);
      setFormas(lista ?? []);
      onChangeRef.current?.(lista ?? []);
    } catch (e) { setErro(e.message); }
  }, [fornecedorId]);
  React.useEffect(() => { carregar(); }, [carregar]);

  async function salvar(e) {
    e.preventDefault(); setSalvando(true); setErro(null);
    try { await salvarFormaPagamento(fornecedorId, form); setForm(null); await carregar(); }
    catch (e) { setErro(e.message); } finally { setSalvando(false); }
  }
  async function excluir(forma) {
    if (!confirm("Excluir estes dados para pagamento? A alteração ficará registrada na Auditoria.")) return;
    try { await excluirFormaPagamento(fornecedorId, forma); await carregar(); } catch (e) { setErro(e.message); }
  }

  return (
    <section className="rounded-xl border border-black/10 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="text-sm font-semibold text-[#0F2A44]">Dados para Pagamento</h3><p className="text-xs text-[#0F2A44]/50">PIX e contas bancárias ficam protegidos dentro da Vida do Fornecedor.</p></div>
        <div className="flex gap-2">
          {permissoes.cadastrar_pix && <button type="button" onClick={() => setForm({ ...VAZIO, kind: "pix" })} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-xs"><Plus size={13}/> Adicionar PIX</button>}
          {permissoes.cadastrar_dados_bancarios && <button type="button" onClick={() => setForm({ ...VAZIO, kind: "bank" })} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-xs"><Plus size={13}/> Adicionar Conta Bancária</button>}
        </div>
      </div>
      {erro && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{erro}</div>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {formas.map((forma) => (
          <div key={forma.id} className="rounded-lg border border-black/10 p-3 text-xs text-[#0F2A44]">
            <div className="flex items-start justify-between gap-2"><div className="font-semibold flex items-center gap-1.5"><CreditCard size={14}/>{forma.kind === "pix" ? `PIX — ${forma.pixKeyType || "chave"}` : forma.bankName}</div>{forma.isPrimary && <span className="flex items-center gap-1 text-amber-700"><Star size={12} fill="currentColor"/> Principal</span>}</div>
            <div className="mt-2 space-y-1 text-[#0F2A44]/65">{forma.kind === "pix" ? <div className="break-all">{forma.pixKey}</div> : <><div>Agência {forma.agency || "--"} · Conta {forma.account || "--"}{forma.accountDigit ? `-${forma.accountDigit}` : ""}</div><div>{forma.accountType || "Conta"}</div></>}<div>Titular: {forma.holderName}</div><div>CPF/CNPJ: {forma.holderDocument || "--"}</div></div>
            <div className="mt-3 flex gap-2">{permissoes[forma.kind === "pix" ? "editar_pix" : "editar_dados_bancarios"] && <button type="button" onClick={() => setForm({ ...forma })} className="flex items-center gap-1 text-[#0F2A44]/70"><Pencil size={12}/> Editar</button>}{permissoes.excluir_dados_bancarios && <button type="button" onClick={() => excluir(forma)} className="flex items-center gap-1 text-red-600"><Trash2 size={12}/> Excluir</button>}</div>
          </div>
        ))}
        {!formas.length && <div className="text-xs text-[#0F2A44]/45">Dados para pagamento pendentes.</div>}
      </div>
      {form && <form onSubmit={salvar} className="mt-4 rounded-xl bg-[#F5F7F8] p-4"><div className="mb-3 flex items-center justify-between"><strong className="text-sm text-[#0F2A44]">{form.id ? "Editar" : "Adicionar"} {form.kind === "pix" ? "PIX" : "conta bancária"}</strong><button type="button" onClick={() => setForm(null)}><X size={16}/></button></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {form.kind === "pix" ? <><select value={form.pixKeyType} onChange={(e)=>setForm({...form,pixKeyType:e.target.value})} className="rounded-lg border px-3 py-2 text-sm"><option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="email">E-mail</option><option value="telefone">Telefone</option><option value="aleatoria">Chave aleatória</option></select><input required value={form.pixKey} onChange={(e)=>setForm({...form,pixKey:e.target.value})} placeholder="Chave PIX" className="rounded-lg border px-3 py-2 text-sm"/></> : <><input required value={form.bankName} onChange={(e)=>setForm({...form,bankName:e.target.value})} placeholder="Banco" className="rounded-lg border px-3 py-2 text-sm"/><input value={form.bankCode} onChange={(e)=>setForm({...form,bankCode:e.target.value})} placeholder="Código do banco" className="rounded-lg border px-3 py-2 text-sm"/><input value={form.agency} onChange={(e)=>setForm({...form,agency:e.target.value})} placeholder="Agência" className="rounded-lg border px-3 py-2 text-sm"/><input required value={form.account} onChange={(e)=>setForm({...form,account:e.target.value})} placeholder="Conta" className="rounded-lg border px-3 py-2 text-sm"/><input value={form.accountDigit} onChange={(e)=>setForm({...form,accountDigit:e.target.value})} placeholder="Dígito" className="rounded-lg border px-3 py-2 text-sm"/><select value={form.accountType} onChange={(e)=>setForm({...form,accountType:e.target.value})} className="rounded-lg border px-3 py-2 text-sm"><option value="corrente">Corrente</option><option value="poupanca">Poupança</option><option value="pagamento">Pagamento</option><option value="outra">Outra</option></select></>}
        <input required value={form.holderName} onChange={(e)=>setForm({...form,holderName:e.target.value})} placeholder="Nome do titular" className="rounded-lg border px-3 py-2 text-sm"/><input value={form.holderDocument} onChange={(e)=>setForm({...form,holderDocument:e.target.value})} placeholder="CPF/CNPJ do titular" className="rounded-lg border px-3 py-2 text-sm"/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isPrimary} onChange={(e)=>setForm({...form,isPrimary:e.target.checked})}/> Marcar como principal</label></div><button disabled={salvando} className="mt-3 rounded-lg bg-[#0F2A44] px-4 py-2 text-sm text-white disabled:opacity-50">{salvando ? "Salvando..." : "Salvar dados"}</button></form>}
    </section>
  );
}
