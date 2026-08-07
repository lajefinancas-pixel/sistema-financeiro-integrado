import React from "react";
import { Plus, X, Save, ChevronDown, ChevronUp, Trash2, Printer, FileText, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabaseClient";
import Layout from "../components/Layout";

function formatBRL(v) {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

const SITUACOES = [
  { value: "em_aberto", label: "Em aberto", cor: "#EA9A1E", bg: "#FFF6E5" },
  { value: "programado", label: "Programado", cor: "#2563EB", bg: "#EAF1FF" },
  { value: "parcialmente_pago", label: "Parcialmente pago", cor: "#7C3AED", bg: "#F3EDFF" },
  { value: "pago", label: "Pago", cor: "#16A34A", bg: "#EAFBF0" },
  { value: "suspenso", label: "Suspenso", cor: "#64748B", bg: "#F1F5F9" },
  { value: "cancelado", label: "Cancelado", cor: "#DC2626", bg: "#FEF2F2" },
];
function situacaoInfo(v) {
  return SITUACOES.find((s) => s.value === v) ?? SITUACOES[0];
}

const ALIQUOTAS_PADRAO = [2, 3, 4, 5];

const FORM_VALOR_VAZIO = {
  fornecedor_id: "",
  numero_processo: "",
  numero_empenho: "",
  numero_nota_fiscal: "",
  data_nota_fiscal: hojeISO(),
  parcela: "",
  valor_bruto: "",
  base_calculo: "",
  optante_simples: true,
  aliquota_iss: "",
  aliquota_iss_outra: "",
  aliquota_ir: "",
  aliquota_ir_outra: "",
  data_vencimento: "",
};

export default function Fornecedores() {
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [secretarias, setSecretarias] = React.useState([]);
  const [fornecedores, setFornecedores] = React.useState([]);
  const [expandido, setExpandido] = React.useState(null);

  const [mostrarForm, setMostrarForm] = React.useState(false);
  const [mostrarFormValor, setMostrarFormValor] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);

  const [form, setForm] = React.useState({
    razao_social: "",
    nome_fantasia: "",
    cpf_cnpj: "",
    secretaria_id: "",
    descricao: "",
    telefone: "",
    email: "",
  });

  const [formValor, setFormValor] = React.useState(FORM_VALOR_VAZIO);
  const [fixarIss, setFixarIss] = React.useState(false);
  const [fixarIr, setFixarIr] = React.useState(false);

  React.useEffect(() => {
    carregarDados();
  }, []);

  async function carregarDados() {
    setCarregando(true);
    setErro(null);
    try {
      const { data: secs, error: e1 } = await supabase
        .from("secretarias").select("id, nome").eq("ativo", true).order("nome");
      if (e1) throw e1;

      const { data: forns, error: e2 } = await supabase
        .from("fornecedores")
        .select("id, razao_social, nome_fantasia, cpf_cnpj, secretaria_id, telefone, email, aliquota_iss_fixa, aliquota_ir_fixa, secretarias(nome)")
        .eq("ativo", true)
        .order("razao_social");
      if (e2) throw e2;

      const { data: valores, error: e3 } = await supabase
        .from("valores_em_aberto")
        .select("*")
        .order("data_vencimento", { ascending: true });
      if (e3) throw e3;

      const comValores = (forns ?? []).map((f) => {
        const valoresDoFornecedor = (valores ?? []).filter((v) => v.fornecedor_id === f.id);
        const totalAberto = valoresDoFornecedor
          .filter((v) => v.situacao !== "pago" && v.situacao !== "cancelado")
          .reduce((acc, v) => acc + (v.valor - (v.valor_pago ?? 0)), 0);
        return { ...f, valores: valoresDoFornecedor, totalAberto };
      });

      setSecretarias(secs ?? []);
      setFornecedores(comValores);
    } catch (e) {
      setErro(e.message ?? "Erro ao carregar dados.");
    } finally {
      setCarregando(false);
    }
  }
  async function criarFornecedor(e) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      if (!form.razao_social || !form.cpf_cnpj || !form.secretaria_id) {
        throw new Error("Preencha razão social, CPF/CNPJ e secretaria.");
      }
      const { error } = await supabase.from("fornecedores").insert({
        razao_social: form.razao_social,
        nome_fantasia: form.nome_fantasia || null,
        cpf_cnpj: form.cpf_cnpj,
        secretaria_id: form.secretaria_id,
        descricao: form.descricao || null,
        telefone: form.telefone || null,
        email: form.email || null,
      });
      if (error) throw error;

      setForm({
        razao_social: "", nome_fantasia: "", cpf_cnpj: "", secretaria_id: "",
        descricao: "", telefone: "", email: "",
      });
      setMostrarForm(false);
      await carregarDados();
    } catch (e) {
      setErro(e.message ?? "Erro ao cadastrar fornecedor.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluirFornecedor(id, nome) {
    if (!confirm(`Excluir o fornecedor "${nome}"? Os valores em aberto dele deixarão de aparecer no sistema.`)) return;
    setErro(null);
    try {
      const { error } = await supabase.from("fornecedores").update({ ativo: false }).eq("id", id);
      if (error) throw error;
      if (expandido === id) setExpandido(null);
      await carregarDados();
    } catch (e) {
      setErro(e.message ?? "Erro ao excluir fornecedor.");
    }
  }

  function aliquotaIssFinal() {
    if (formValor.aliquota_iss === "outra") return parseFloat(formValor.aliquota_iss_outra || "0");
    return parseFloat(formValor.aliquota_iss || "0");
  }
  function aliquotaIrFinal() {
    if (formValor.aliquota_ir === "outra") return parseFloat(formValor.aliquota_ir_outra || "0");
    return parseFloat(formValor.aliquota_ir || "0");
  }

  function calcularISS() {
    const base = parseFloat(formValor.base_calculo || formValor.valor_bruto || "0");
    return base * (aliquotaIssFinal() / 100);
  }
  function calcularIR() {
    const base = parseFloat(formValor.base_calculo || formValor.valor_bruto || "0");
    return base * (aliquotaIrFinal() / 100);
  }
  function calcularValorLiquido() {
    const bruto = parseFloat(formValor.valor_bruto || "0");
    if (formValor.optante_simples) return bruto;
    return bruto - calcularISS() - calcularIR();
  }

  function selecionarFornecedorNoValor(fornecedorId) {
    const fornecedor = fornecedores.find((f) => String(f.id) === String(fornecedorId));
    setFormValor({
      ...formValor,
      fornecedor_id: fornecedorId,
      aliquota_iss: fornecedor?.aliquota_iss_fixa ? String(fornecedor.aliquota_iss_fixa) : "",
      aliquota_ir: fornecedor?.aliquota_ir_fixa ? String(fornecedor.aliquota_ir_fixa) : "",
    });
    setFixarIss(false);
    setFixarIr(false);
  }
  async function criarValor(e) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      if (!formValor.fornecedor_id) throw new Error("Selecione o fornecedor.");
      if (!formValor.valor_bruto) throw new Error("Informe o valor da nota.");

      const bruto = parseFloat(formValor.valor_bruto);
      const base = parseFloat(formValor.base_calculo || formValor.valor_bruto);
      const issAliquota = formValor.optante_simples ? 0 : aliquotaIssFinal();
      const irAliquota = formValor.optante_simples ? 0 : aliquotaIrFinal();
      const iss = formValor.optante_simples ? 0 : calcularISS();
      const ir = formValor.optante_simples ? 0 : calcularIR();
      const liquido = bruto - iss - ir;

      const { error } = await supabase.from("valores_em_aberto").insert({
        fornecedor_id: formValor.fornecedor_id,
        numero_processo: formValor.numero_processo || null,
        numero_empenho: formValor.numero_empenho || null,
        numero_nota_fiscal: formValor.numero_nota_fiscal || null,
        data_nota_fiscal: formValor.data_nota_fiscal || null,
        parcela: formValor.parcela || null,
        valor_bruto: bruto,
        base_calculo: base,
        valor: liquido,
        optante_simples: formValor.optante_simples,
        desconto_iss: iss,
        desconto_ir: ir,
        aliquota_iss: issAliquota,
        aliquota_ir: irAliquota,
        data_vencimento: formValor.data_vencimento || null,
        situacao: "em_aberto",
      });
      if (error) throw error;

      if (!formValor.optante_simples) {
        const updates = {};
        if (fixarIss) updates.aliquota_iss_fixa = issAliquota;
        if (fixarIr) updates.aliquota_ir_fixa = irAliquota;
        if (Object.keys(updates).length > 0) {
          await supabase.from("fornecedores").update(updates).eq("id", formValor.fornecedor_id);
        }
      }

      setFormValor(FORM_VALOR_VAZIO);
      setFixarIss(false);
      setFixarIr(false);
      setMostrarFormValor(false);
      await carregarDados();
    } catch (e) {
      setErro(e.message ?? "Erro ao adicionar valor.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluirValor(id) {
    if (!confirm("Excluir este valor em aberto?")) return;
    setErro(null);
    try {
      const { error } = await supabase.from("valores_em_aberto").delete().eq("id", id);
      if (error) throw error;
      await carregarDados();
    } catch (e) {
      setErro(e.message ?? "Erro ao excluir valor.");
    }
  }

  async function mudarSituacao(valorId, novaSituacao) {
    setErro(null);
    try {
      const { error } = await supabase.from("valores_em_aberto").update({ situacao: novaSituacao }).eq("id", valorId);
      if (error) throw error;
      await carregarDados();
    } catch (e) {
      setErro(e.message ?? "Erro ao atualizar situação.");
    }
  }

  function exportarExcel() {
    const linhas = [];
    fornecedores.forEach((f) => {
      if (f.valores.length === 0) {
        linhas.push({ Fornecedor: f.razao_social, CPF_CNPJ: f.cpf_cnpj, NF: "", Bruto: "", ISS: "", IR: "", Liquido: "", Situacao: "" });
      }
      f.valores.forEach((v) => {
        linhas.push({
          Fornecedor: f.razao_social,
          CPF_CNPJ: f.cpf_cnpj,
          NF: v.numero_nota_fiscal ?? "",
          Bruto: v.valor_bruto ?? v.valor,
          ISS: v.desconto_iss ?? 0,
          IR: v.desconto_ir ?? 0,
          Liquido: v.valor,
          Situacao: v.situacao,
        });
      });
    });
    const ws = XLSX.utils.json_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fornecedores");
    XLSX.writeFile(wb, `fornecedores-${hojeISO()}.xlsx`);
  }

  const totalGeralAberto = fornecedores.reduce((acc, f) => acc + f.totalAberto, 0);
  return (
    <Layout>
      <div className="px-8 py-7 print:px-0 print:py-0">
        <div className="flex items-start justify-between mb-6 print:mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-[#0F2A44]">Fornecedores</h1>
            <p className="text-sm text-[#0F2A44]/60 mt-0.5">
              Total em aberto: <span className="font-semibold">{formatBRL(totalGeralAberto)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <button onClick={() => window.print()} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5">
              <Printer size={14} /> Imprimir
            </button>
            <button onClick={() => window.print()} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5">
              <FileText size={14} /> PDF
            </button>
            <button onClick={exportarExcel} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5">
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button
              onClick={() => { setMostrarFormValor((v) => !v); setMostrarForm(false); }}
              className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border border-black/10 text-[#0F2A44] hover:bg-black/5"
            >
              {mostrarFormValor ? <X size={16} /> : <Plus size={16} />}
              {mostrarFormValor ? "Cancelar" : "Novo Valor em Aberto"}
            </button>
            <button
              onClick={() => { setMostrarForm((v) => !v); setMostrarFormValor(false); }}
              className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90"
            >
              {mostrarForm ? <X size={16} /> : <Plus size={16} />}
              {mostrarForm ? "Cancelar" : "Novo Fornecedor"}
            </button>
          </div>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-5 print:hidden">
            {erro}
          </div>
        )}

        {mostrarFormValor && (
          <form
            onSubmit={criarValor}
            className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-6 space-y-4 print:hidden"
          >
            <h2 className="text-base font-semibold text-[#0F2A44]">Cadastrar valor em aberto</h2>

            <div>
              <label className="text-xs font-medium text-[#0F2A44]/70">Fornecedor</label>
              <select
                value={formValor.fornecedor_id}
                onChange={(e) => selecionarFornecedorNoValor(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
              >
                <option value="">Selecione...</option>
                {fornecedores.map((f) => (
                  <option key={f.id} value={f.id}>{f.razao_social}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Número da NF</label>
                <input
                  type="text"
                  value={formValor.numero_nota_fiscal}
                  onChange={(e) => setFormValor({ ...formValor, numero_nota_fiscal: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Data da NF</label>
                <input
                  type="date"
                  value={formValor.data_nota_fiscal}
                  onChange={(e) => setFormValor({ ...formValor, data_nota_fiscal: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Valor bruto da nota</label>
                <input
                  type="number" step="0.01" placeholder="0,00"
                  value={formValor.valor_bruto}
                  onChange={(e) => setFormValor({ ...formValor, valor_bruto: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-[#0F2A44]/70 block mb-1.5">Optante pelo Simples Nacional?</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFormValor({ ...formValor, optante_simples: true })}
                  className={`px-4 py-2 rounded-lg text-sm border ${
                    formValor.optante_simples ? "bg-[#0F2A44] text-white border-[#0F2A44]" : "border-black/10 text-[#0F2A44]/60"
                  }`}
                >
                  Sim
                </button>
                <button
                  type="button"
                  onClick={() => setFormValor({ ...formValor, optante_simples: false })}
                  className={`px-4 py-2 rounded-lg text-sm border ${
                    !formValor.optante_simples ? "bg-[#0F2A44] text-white border-[#0F2A44]" : "border-black/10 text-[#0F2A44]/60"
                  }`}
                >
                  Não
                </button>
              </div>
            </div>
            {!formValor.optante_simples && (
              <div className="bg-[#0F2A44]/[0.03] rounded-lg p-4 space-y-4">
                <div>
                  <label className="text-xs font-medium text-[#0F2A44]/70">Base de cálculo</label>
                  <input
                    type="number" step="0.01"
                    placeholder={formValor.valor_bruto || "0,00"}
                    value={formValor.base_calculo}
                    onChange={(e) => setFormValor({ ...formValor, base_calculo: e.target.value })}
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                  />
                  <p className="text-[10px] text-[#0F2A44]/40 mt-1">Deixe em branco para usar o valor bruto como base.</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-[#0F2A44]/70 block mb-1.5">Alíquota de ISS</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {ALIQUOTAS_PADRAO.map((a) => (
                        <button
                          key={a}
                          type="button"
                          onClick={() => setFormValor({ ...formValor, aliquota_iss: String(a) })}
                          className={`px-3 py-1.5 rounded-md text-xs border ${
                            formValor.aliquota_iss === String(a)
                              ? "bg-[#0F2A44] text-white border-[#0F2A44]"
                              : "border-black/10 text-[#0F2A44]/60"
                          }`}
                        >
                          {a}%
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setFormValor({ ...formValor, aliquota_iss: "outra" })}
                        className={`px-3 py-1.5 rounded-md text-xs border ${
                          formValor.aliquota_iss === "outra"
                            ? "bg-[#0F2A44] text-white border-[#0F2A44]"
                            : "border-black/10 text-[#0F2A44]/60"
                        }`}
                      >
                        Outra
                      </button>
                    </div>
                    {formValor.aliquota_iss === "outra" && (
                      <input
                        type="number" step="0.01" placeholder="Ex: 3.5"
                        value={formValor.aliquota_iss_outra}
                        onChange={(e) => setFormValor({ ...formValor, aliquota_iss_outra: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-black/10 text-sm mb-2"
                      />
                    )}
                    <label className="flex items-center gap-1.5 text-xs text-[#0F2A44]/60">
                      <input type="checkbox" checked={fixarIss} onChange={(e) => setFixarIss(e.target.checked)} className="w-3.5 h-3.5 accent-[#0F2A44]" />
                      Fixar esta alíquota para este fornecedor
                    </label>
                    <div className="text-xs text-[#0F2A44]/70 mt-1.5">ISS retido: <span className="font-semibold">{formatBRL(calcularISS())}</span></div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-[#0F2A44]/70 block mb-1.5">Alíquota de IR</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {ALIQUOTAS_PADRAO.map((a) => (
                        <button
                          key={a}
                          type="button"
                          onClick={() => setFormValor({ ...formValor, aliquota_ir: String(a) })}
                          className={`px-3 py-1.5 rounded-md text-xs border ${
                            formValor.aliquota_ir === String(a)
                              ? "bg-[#0F2A44] text-white border-[#0F2A44]"
                              : "border-black/10 text-[#0F2A44]/60"
                          }`}
                        >
                          {a}%
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setFormValor({ ...formValor, aliquota_ir: "outra" })}
                        className={`px-3 py-1.5 rounded-md text-xs border ${
                          formValor.aliquota_ir === "outra"
                            ? "bg-[#0F2A44] text-white border-[#0F2A44]"
                            : "border-black/10 text-[#0F2A44]/60"
                        }`}
                      >
                        Outra
                      </button>
                    </div>
                    {formValor.aliquota_ir === "outra" && (
                      <input
                        type="number" step="0.01" placeholder="Ex: 1.5"
                        value={formValor.aliquota_ir_outra}
                        onChange={(e) => setFormValor({ ...formValor, aliquota_ir_outra: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-black/10 text-sm mb-2"
                      />
                    )}
                    <label className="flex items-center gap-1.5 text-xs text-[#0F2A44]/60">
                      <input type="checkbox" checked={fixarIr} onChange={(e) => setFixarIr(e.target.checked)} className="w-3.5 h-3.5 accent-[#0F2A44]" />
                      Fixar esta alíquota para este fornecedor
                    </label>
                    <div className="text-xs text-[#0F2A44]/70 mt-1.5">IR retido: <span className="font-semibold">{formatBRL(calcularIR())}</span></div>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-[#EAF1FF] rounded-lg px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-[#0F2A44]/70">Valor líquido da nota</span>
              <span className="text-base font-semibold text-[#0F2A44]">{formatBRL(calcularValorLiquido())}</span>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Processo (opcional)</label>
                <input
                  type="text"
                  value={formValor.numero_processo}
                  onChange={(e) => setFormValor({ ...formValor, numero_processo: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Empenho (opcional)</label>
                <input
                  type="text"
                  value={formValor.numero_empenho}
                  onChange={(e) => setFormValor({ ...formValor, numero_empenho: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Vencimento</label>
                <input
                  type="date"
                  value={formValor.data_vencimento}
                  onChange={(e) => setFormValor({ ...formValor, data_vencimento: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
            </div>

            <button
              type="submit" disabled={salvando}
              className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 disabled:opacity-50"
            >
              <Save size={15} />
              {salvando ? "Salvando..." : "Salvar valor em aberto"}
            </button>
          </form>
        )}
        {mostrarForm && (
          <form
            onSubmit={criarFornecedor}
            className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-6 space-y-4 print:hidden"
          >
            <h2 className="text-base font-semibold text-[#0F2A44]">Cadastrar fornecedor</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Razão social</label>
                <input
                  type="text"
                  value={form.razao_social}
                  onChange={(e) => setForm({ ...form, razao_social: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Nome fantasia (opcional)</label>
                <input
                  type="text"
                  value={form.nome_fantasia}
                  onChange={(e) => setForm({ ...form, nome_fantasia: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">CPF ou CNPJ</label>
                <input
                  type="text"
                  value={form.cpf_cnpj}
                  onChange={(e) => setForm({ ...form, cpf_cnpj: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Secretaria</label>
                <select
                  value={form.secretaria_id}
                  onChange={(e) => setForm({ ...form, secretaria_id: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                >
                  <option value="">Selecione...</option>
                  {secretarias.map((s) => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Telefone (opcional)</label>
                <input
                  type="text"
                  value={form.telefone}
                  onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">E-mail (opcional)</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-[#0F2A44]/70">Descrição do serviço/fornecimento (opcional)</label>
              <textarea
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                rows={2}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
              />
            </div>

            <button
              type="submit" disabled={salvando}
              className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 disabled:opacity-50"
            >
              <Save size={15} />
              {salvando ? "Salvando..." : "Salvar fornecedor"}
            </button>
          </form>
        )}
        {carregando ? (
          <div className="text-sm text-[#0F2A44]/50">Carregando...</div>
        ) : fornecedores.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-black/10 p-10 text-center text-sm text-[#0F2A44]/40">
            Nenhum fornecedor cadastrado ainda.
          </div>
        ) : (
          <div className="space-y-3">
            {fornecedores.map((f) => (
              <div key={f.id} className="rounded-xl border border-black/5 overflow-hidden bg-white print:break-inside-avoid">
                <div className="w-full flex items-center justify-between px-4 py-3 hover:bg-black/[0.02]">
                  <button onClick={() => setExpandido(expandido === f.id ? null : f.id)} className="flex-1 text-left">
                    <div className="text-sm font-semibold text-[#0F2A44]">{f.razao_social}</div>
                    <div className="text-xs text-[#0F2A44]/50">
                      {f.cpf_cnpj} · {f.secretarias?.nome ?? "--"}
                      {(f.aliquota_iss_fixa || f.aliquota_ir_fixa) && (
                        <span className="ml-2 text-[10px] text-[#0F2A44]/40">
                          {f.aliquota_iss_fixa ? `ISS fixo: ${f.aliquota_iss_fixa}%` : ""}
                          {f.aliquota_iss_fixa && f.aliquota_ir_fixa ? " · " : ""}
                          {f.aliquota_ir_fixa ? `IR fixo: ${f.aliquota_ir_fixa}%` : ""}
                        </span>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-[#0F2A44]">{formatBRL(f.totalAberto)}</span>
                    <button
                      onClick={() => excluirFornecedor(f.id, f.razao_social)}
                      className="text-[#0F2A44]/30 hover:text-red-500 print:hidden"
                      title="Excluir fornecedor"
                    >
                      <Trash2 size={15} />
                    </button>
                    <button onClick={() => setExpandido(expandido === f.id ? null : f.id)} className="print:hidden">
                      {expandido === f.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>

                {expandido === f.id && (
                  <div className="border-t border-black/5 px-4 py-3">
                    {f.valores.length === 0 ? (
                      <div className="text-xs text-[#0F2A44]/40">Nenhum valor cadastrado.</div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/40">
                            <th className="py-1.5 font-medium">NF</th>
                            <th className="py-1.5 font-medium">Vencimento</th>
                            <th className="py-1.5 font-medium text-right">Bruto</th>
                            <th className="py-1.5 font-medium text-right">ISS</th>
                            <th className="py-1.5 font-medium text-right">IR</th>
                            <th className="py-1.5 font-medium text-right">Líquido</th>
                            <th className="py-1.5 font-medium text-right">Situação</th>
                            <th className="py-1.5 font-medium text-right print:hidden">Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {f.valores.map((v) => {
                            const info = situacaoInfo(v.situacao);
                            return (
                              <tr key={v.id} className="border-t border-black/5">
                                <td className="py-2 text-xs text-[#0F2A44]/70">
                                  {v.numero_nota_fiscal || "--"}{v.parcela ? ` (${v.parcela})` : ""}
                                </td>
                                <td className="py-2 text-xs text-[#0F2A44]/70">
                                  {v.data_vencimento ? new Date(v.data_vencimento + "T00:00:00").toLocaleDateString("pt-BR") : "--"}
                                </td>
                                <td className="py-2 text-right tabular-nums text-xs">{formatBRL(v.valor_bruto ?? v.valor)}</td>
                                <td className="py-2 text-right tabular-nums text-xs text-red-600">
                                  {v.desconto_iss > 0 ? `${formatBRL(v.desconto_iss)} (${v.aliquota_iss}%)` : "--"}
                                </td>
                                <td className="py-2 text-right tabular-nums text-xs text-red-600">
                                  {v.desconto_ir > 0 ? `${formatBRL(v.desconto_ir)} (${v.aliquota_ir}%)` : "--"}
                                </td>
                                <td className="py-2 text-right tabular-nums font-medium">{formatBRL(v.valor)}</td>
                                <td className="py-2 text-right">
                                  <select
                                    value={v.situacao}
                                    onChange={(e) => mudarSituacao(v.id, e.target.value)}
                                    style={{ color: info.cor, backgroundColor: info.bg }}
                                    className="text-xs font-medium px-2 py-1 rounded-md border-none"
                                  >
                                    {SITUACOES.map((s) => (
                                      <option key={s.value} value={s.value}>{s.label}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="py-2 text-right print:hidden">
                                  <button onClick={() => excluirValor(v.id)} className="text-[#0F2A44]/30 hover:text-red-500">
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
