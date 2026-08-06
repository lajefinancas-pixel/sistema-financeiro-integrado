import React from "react";
import { Plus, X, Save, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import Layout from "../components/Layout";

function formatBRL(v) {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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

export default function Fornecedores() {
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [secretarias, setSecretarias] = React.useState([]);
  const [fornecedores, setFornecedores] = React.useState([]);
  const [expandido, setExpandido] = React.useState(null);

  const [mostrarForm, setMostrarForm] = React.useState(false);
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

  const [formValor, setFormValor] = React.useState({
    numero_processo: "",
    numero_empenho: "",
    numero_nota_fiscal: "",
    parcela: "",
    valor: "",
    data_vencimento: "",
  });
  const [fornecedorParaValor, setFornecedorParaValor] = React.useState(null);

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
        .select("id, razao_social, nome_fantasia, cpf_cnpj, secretaria_id, telefone, email, secretarias(nome)")
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
        razao_social: "",
        nome_fantasia: "",
        cpf_cnpj: "",
        secretaria_id: "",
        descricao: "",
        telefone: "",
        email: "",
      });
      setMostrarForm(false);
      await carregarDados();
    } catch (e) {
      setErro(e.message ?? "Erro ao cadastrar fornecedor.");
    } finally {
      setSalvando(false);
    }
  }

  async function adicionarValor(fornecedorId) {
    setSalvando(true);
    setErro(null);
    try {
      if (!formValor.valor) throw new Error("Informe o valor.");
      const { error } = await supabase.from("valores_em_aberto").insert({
        fornecedor_id: fornecedorId,
        numero_processo: formValor.numero_processo || null,
        numero_empenho: formValor.numero_empenho || null,
        numero_nota_fiscal: formValor.numero_nota_fiscal || null,
        parcela: formValor.parcela || null,
        valor: parseFloat(formValor.valor),
        data_vencimento: formValor.data_vencimento || null,
        situacao: "em_aberto",
      });
      if (error) throw error;

      setFormValor({
        numero_processo: "",
        numero_empenho: "",
        numero_nota_fiscal: "",
        parcela: "",
        valor: "",
        data_vencimento: "",
      });
      setFornecedorParaValor(null);
      await carregarDados();
    } catch (e) {
      setErro(e.message ?? "Erro ao adicionar valor.");
    } finally {
      setSalvando(false);
    }
  }

  async function mudarSituacao(valorId, novaSituacao) {
    setErro(null);
    try {
      const { error } = await supabase
        .from("valores_em_aberto")
        .update({ situacao: novaSituacao })
        .eq("id", valorId);
      if (error) throw error;
      await carregarDados();
    } catch (e) {
      setErro(e.message ?? "Erro ao atualizar situação.");
    }
  }

  const totalGeralAberto = fornecedores.reduce((acc, f) => acc + f.totalAberto, 0);
  return (
    <Layout>
      <div className="px-8 py-7">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-[#0F2A44]">Fornecedores</h1>
            <p className="text-sm text-[#0F2A44]/60 mt-0.5">
              Total em aberto: <span className="font-semibold">{formatBRL(totalGeralAberto)}</span>
            </p>
          </div>
          <button
            onClick={() => setMostrarForm((v) => !v)}
            className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90"
          >
            {mostrarForm ? <X size={16} /> : <Plus size={16} />}
            {mostrarForm ? "Cancelar" : "Novo Fornecedor"}
          </button>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-5">
            {erro}
          </div>
        )}

        {mostrarForm && (
          <form
            onSubmit={criarFornecedor}
            className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-6 space-y-4"
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
              type="submit"
              disabled={salvando}
              className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 disabled:opacity-50"
            >
              <Save size={15} />
              {salvando ? "Salvando..." : "Salvar fornecedor"}
            </button>
          </form>
        )}
import React from "react";
import { Plus, X, Save, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import Layout from "../components/Layout";

function formatBRL(v) {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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

export default function Fornecedores() {
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [secretarias, setSecretarias] = React.useState([]);
  const [fornecedores, setFornecedores] = React.useState([]);
  const [expandido, setExpandido] = React.useState(null);

  const [mostrarForm, setMostrarForm] = React.useState(false);
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

  const [formValor, setFormValor] = React.useState({
    numero_processo: "",
    numero_empenho: "",
    numero_nota_fiscal: "",
    parcela: "",
    valor: "",
    data_vencimento: "",
  });
  const [fornecedorParaValor, setFornecedorParaValor] = React.useState(null);

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
        .select("id, razao_social, nome_fantasia, cpf_cnpj, secretaria_id, telefone, email, secretarias(nome)")
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
