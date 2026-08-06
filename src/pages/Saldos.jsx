import React from "react";
import { Plus, X, Pencil, Save, Trash2, Printer, FileText, FileSpreadsheet, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabaseClient";
import Layout from "../components/Layout";

const CORES = ["#2563EB", "#16A34A", "#EA9A1E", "#7C3AED", "#DB2777", "#0EA5E9", "#059669", "#D97706"];

function formatBRL(v) {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}
function hojeBR() {
  return new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export default function Saldos() {
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [secretarias, setSecretarias] = React.useState([]);
  const [bancos, setBancos] = React.useState([]);
  const [contasPorSecretaria, setContasPorSecretaria] = React.useState([]);

  const [mostrarForm, setMostrarForm] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [novoBanco, setNovoBanco] = React.useState(false);
  const [novaSecretaria, setNovaSecretaria] = React.useState(false);

  const [mostrarImportar, setMostrarImportar] = React.useState(false);
  const [textoImportar, setTextoImportar] = React.useState("");
  const [importando, setImportando] = React.useState(false);
  const [resultadoImportar, setResultadoImportar] = React.useState(null);

  const [form, setForm] = React.useState({
    secretaria_id: "",
    secretaria_novo_nome: "",
    banco_id: "",
    banco_novo_nome: "",
    nome_conta: "",
    numero_conta: "",
    tipo_conta: "",
    saldo_inicial: "",
    data_saldo: hojeISO(),
  });

  const [editando, setEditando] = React.useState(null);
  const [novoSaldo, setNovoSaldo] = React.useState({ valor: "", data: hojeISO() });

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

      const { data: bcs, error: e2 } = await supabase
        .from("bancos").select("id, nome").order("nome");
      if (e2) throw e2;

      const { data: contas, error: e3 } = await supabase
        .from("contas_bancarias")
        .select("id, nome_conta, numero_conta, tipo_conta, secretaria_id, banco_id, bancos(nome)")
        .eq("ativo", true);
      if (e3) throw e3;

      const { data: saldos, error: e4 } = await supabase
        .from("saldos_historico")
        .select("conta_id, valor_saldo, data_saldo")
        .order("data_saldo", { ascending: false });
      if (e4) throw e4;

      const ultimoSaldo = {};
      for (const s of saldos ?? []) {
        if (!(s.conta_id in ultimoSaldo)) ultimoSaldo[s.conta_id] = s;
      }

      const agrupado = (secs ?? []).map((sec, i) => {
        const contasDaSec = (contas ?? [])
          .filter((c) => c.secretaria_id === sec.id)
          .map((c) => ({
            id: c.id,
            banco: c.bancos?.nome ?? "--",
            nome_conta: c.nome_conta,
            numero_conta: c.numero_conta,
            saldo: ultimoSaldo[c.id]?.valor_saldo ?? 0,
          }));
        return { id: sec.id, nome: sec.nome, cor: CORES[i % CORES.length], contas: contasDaSec };
      });

      setSecretarias(secs ?? []);
      setBancos(bcs ?? []);
      setContasPorSecretaria(agrupado);
    } catch (e) {
      setErro(e.message ?? "Erro ao carregar dados.");
    } finally {
      setCarregando(false);
    }
  }
  const [editandoSecretariaId, setEditandoSecretariaId] = React.useState(null);
  const [saldosLote, setSaldosLote] = React.useState({});
  const [dataLote, setDataLote] = React.useState(hojeISO());

  function iniciarEdicaoLote(sec) {
    const inicial = {};
    sec.contas.forEach((c) => {
      inicial[c.id] = String(c.saldo);
    });
    setSaldosLote(inicial);
    setDataLote(hojeISO());
    setEditandoSecretariaId(sec.id);
  }

  async function salvarLote(sec) {
    setSalvando(true);
    setErro(null);
    try {
      const linhas = sec.contas.map((c) => ({
        conta_id: c.id,
        valor_saldo: parseFloat(saldosLote[c.id] || "0"),
        data_saldo: dataLote,
      }));
      const { error } = await supabase
        .from("saldos_historico")
        .upsert(linhas, { onConflict: "conta_id,data_saldo" });
      if (error) throw error;
      setEditandoSecretariaId(null);
      setSaldosLote({});
      await carregarDados();
    } catch (e) {
      setErro(e.message ?? "Erro ao salvar saldos em lote.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluirConta(contaId) {
    if (!confirm("Excluir esta conta bancária? Os saldos dela também serão removidos do painel.")) return;
    setErro(null);
    try {
      const { error } = await supabase.from("contas_bancarias").update({ ativo: false }).eq("id", contaId);
      if (error) throw error;
      await carregarDados();
    } catch (e) {
      setErro(e.message ?? "Erro ao excluir conta.");
    }
  }

  async function excluirSecretaria(secretariaId, nome) {
    if (!confirm(`Excluir a secretaria "${nome}"? As contas cadastradas nela deixarão de aparecer no painel.`)) return;
    setErro(null);
    try {
      const { error } = await supabase.from("secretarias").update({ ativo: false }).eq("id", secretariaId);
      if (error) throw error;
      await carregarDados();
    } catch (e) {
      setErro(e.message ?? "Erro ao excluir secretaria.");
    }
  }

  async function criarConta(e) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      let secretariaId = form.secretaria_id;
      let bancoId = form.banco_id;

      if (novaSecretaria && form.secretaria_novo_nome.trim()) {
        const { data: secData, error: eSec } = await supabase
          .from("secretarias").insert({ nome: form.secretaria_novo_nome.trim() }).select().single();
        if (eSec) throw eSec;
        secretariaId = secData.id;
      }

      if (novoBanco && form.banco_novo_nome.trim()) {
        const { data: bancoData, error: eBanco } = await supabase
          .from("bancos").insert({ nome: form.banco_novo_nome.trim() }).select().single();
        if (eBanco) throw eBanco;
        bancoId = bancoData.id;
      }

      if (!secretariaId || !bancoId || !form.nome_conta) {
        throw new Error("Preencha secretaria, banco e nome da conta.");
      }

      const { data: contaData, error: eConta } = await supabase
        .from("contas_bancarias")
        .insert({
          secretaria_id: secretariaId, banco_id: bancoId, nome_conta: form.nome_conta,
          numero_conta: form.numero_conta || null, tipo_conta: form.tipo_conta || null,
        }).select().single();
      if (eConta) throw eConta;

      const valorInicial = parseFloat(form.saldo_inicial || "0");
      const { error: eSaldo } = await supabase.from("saldos_historico").insert({
        conta_id: contaData.id, valor_saldo: valorInicial, data_saldo: form.data_saldo,
      });
      if (eSaldo) throw eSaldo;

      setForm({
        secretaria_id: "", secretaria_novo_nome: "", banco_id: "", banco_novo_nome: "",
        nome_conta: "", numero_conta: "", tipo_conta: "", saldo_inicial: "", data_saldo: hojeISO(),
      });
      setNovoBanco(false);
      setNovaSecretaria(false);
      setMostrarForm(false);
      await carregarDados();
    } catch (e) {
      setErro(e.message ?? "Erro ao criar conta.");
    } finally {
      setSalvando(false);
    }
  }

  async function salvarNovoSaldo(contaId) {
    setSalvando(true);
    setErro(null);
    try {
      const valor = parseFloat(novoSaldo.valor || "0");
      const { error } = await supabase.from("saldos_historico").upsert(
        { conta_id: contaId, valor_saldo: valor, data_saldo: novoSaldo.data },
        { onConflict: "conta_id,data_saldo" }
      );
      if (error) throw error;
      setEditando(null);
      setNovoSaldo({ valor: "", data: hojeISO() });
      await carregarDados();
    } catch (e) {
      setErro(e.message ?? "Erro ao atualizar saldo.");
    } finally {
      setSalvando(false);
    }
  }

  function exportarExcel() {
    const linhas = [];
    contasPorSecretaria.forEach((sec) => {
      sec.contas.forEach((c) => {
        linhas.push({ Secretaria: sec.nome, Banco: c.banco, Conta: c.nome_conta, Saldo: c.saldo });
      });
    });
    const ws = XLSX.utils.json_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Saldos");
    XLSX.writeFile(wb, `saldos-${hojeISO()}.xlsx`);
  }
  async function importarLote() {
    setImportando(true);
    setErro(null);
    setResultadoImportar(null);
    try {
      const linhas = textoImportar
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      let criadas = 0;
      let erros = [];

      const secretariasCache = {};
      const bancosCache = {};

      for (const linha of linhas) {
        const partes = linha.split(";").map((p) => p.trim());
        if (partes.length < 4) {
          erros.push(`Linha ignorada (formato incompleto): ${linha}`);
          continue;
        }
        const [secretariaNome, bancoNome, numeroConta, nomeConta, saldoStr] = partes;

        try {
          let secretariaId = secretariasCache[secretariaNome.toLowerCase()];
          if (!secretariaId) {
            const existente = secretarias.find(
              (s) => s.nome.toLowerCase() === secretariaNome.toLowerCase()
            );
            if (existente) {
              secretariaId = existente.id;
            } else {
              const { data, error } = await supabase
                .from("secretarias").insert({ nome: secretariaNome }).select().single();
              if (error) throw error;
              secretariaId = data.id;
              secretarias.push({ id: data.id, nome: secretariaNome });
            }
            secretariasCache[secretariaNome.toLowerCase()] = secretariaId;
          }

          let bancoId = bancosCache[bancoNome.toLowerCase()];
          if (!bancoId) {
            const existente = bancos.find((b) => b.nome.toLowerCase() === bancoNome.toLowerCase());
            if (existente) {
              bancoId = existente.id;
            } else {
              const { data, error } = await supabase
                .from("bancos").insert({ nome: bancoNome }).select().single();
              if (error) throw error;
              bancoId = data.id;
              bancos.push({ id: data.id, nome: bancoNome });
            }
            bancosCache[bancoNome.toLowerCase()] = bancoId;
          }

          const { data: contaData, error: eConta } = await supabase
            .from("contas_bancarias")
            .insert({
              secretaria_id: secretariaId,
              banco_id: bancoId,
              nome_conta: nomeConta,
              numero_conta: numeroConta || null,
            })
            .select()
            .single();
          if (eConta) throw eConta;

          const valor = parseFloat((saldoStr || "0").replace(",", "."));
          const { error: eSaldo } = await supabase.from("saldos_historico").insert({
            conta_id: contaData.id,
            valor_saldo: isNaN(valor) ? 0 : valor,
            data_saldo: hojeISO(),
          });
          if (eSaldo) throw eSaldo;

          criadas++;
        } catch (e) {
          erros.push(`Erro na linha "${linha}": ${e.message}`);
        }
      }

      setResultadoImportar({ criadas, erros });
      if (criadas > 0) {
        setTextoImportar("");
        await carregarDados();
      }
    } catch (e) {
      setErro(e.message ?? "Erro ao importar.");
    } finally {
      setImportando(false);
    }
  }
  return (
    <Layout>
      <div className="px-8 py-7 print:px-0 print:py-0">
        <div className="pl-3 border-l-2 border-[#0F2A44]/10 mb-4 print:hidden">
          <span className="text-xs text-[#0F2A44]/50">Saldo emitido em</span>
          <div className="text-sm font-medium text-[#0F2A44]">{hojeBR()}</div>
        </div>

        <div className="flex items-start justify-between mb-6 print:mb-4">
          <h1 className="text-2xl font-semibold text-[#0F2A44]">Saldos das Contas</h1>
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
              onClick={() => { setMostrarImportar((v) => !v); setMostrarForm(false); }}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
            >
              <Upload size={14} /> Importar em lote
            </button>
            <button
              onClick={() => { setMostrarForm((v) => !v); setMostrarImportar(false); }}
              className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90"
            >
              {mostrarForm ? <X size={16} /> : <Plus size={16} />}
              {mostrarForm ? "Cancelar" : "Novo Registro"}
            </button>
          </div>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-5 print:hidden">
            {erro}
          </div>
        )}

        {mostrarImportar && (
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-6 space-y-3 print:hidden">
            <h2 className="text-base font-semibold text-[#0F2A44]">Importar contas em lote</h2>
            <p className="text-xs text-[#0F2A44]/60">
              Cole uma linha por conta, no formato:{" "}
              <span className="font-mono bg-black/5 px-1 rounded">Secretaria;Banco;Número;Nome da conta;Saldo</span>
              <br />
              Secretarias e bancos que ainda não existirem serão criados automaticamente.
            </p>
            <textarea
              value={textoImportar}
              onChange={(e) => setTextoImportar(e.target.value)}
              rows={8}
              placeholder={"Secretaria de Finanças;Banco do Brasil;2.042-7;PREFEITURA;1000\nSecretaria de Saúde;Banco do Brasil;9.500-1;VIGILÂNCIA SANITÁRIA;2500"}
              className="w-full px-3 py-2 rounded-lg border border-black/10 text-xs font-mono"
            />
            {resultadoImportar && (
              <div className="text-xs space-y-1">
                <div className="text-green-700 font-medium">{resultadoImportar.criadas} conta(s) importada(s) com sucesso.</div>
                {resultadoImportar.erros.length > 0 && (
                  <div className="text-red-600">
                    {resultadoImportar.erros.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={importarLote}
              disabled={importando || !textoImportar.trim()}
              className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 disabled:opacity-50"
            >
              <Upload size={15} />
              {importando ? "Importando..." : "Importar"}
            </button>
          </div>
        )}
        {mostrarForm && (
          <form
            onSubmit={criarConta}
            className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-6 space-y-4 print:hidden"
          >
            <h2 className="text-base font-semibold text-[#0F2A44]">Cadastrar nova conta</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Secretaria</label>
                {!novaSecretaria ? (
                  <select
                    value={form.secretaria_id}
                    onChange={(e) => {
                      if (e.target.value === "__nova__") setNovaSecretaria(true);
                      else setForm({ ...form, secretaria_id: e.target.value });
                    }}
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                  >
                    <option value="">Selecione...</option>
                    {secretarias.map((s) => (
                      <option key={s.id} value={s.id}>{s.nome}</option>
                    ))}
                    <option value="__nova__">+ Cadastrar nova secretaria</option>
                  </select>
                ) : (
                  <div className="flex gap-2 mt-1">
                    <input
                      type="text" placeholder="Nome da nova secretaria"
                      value={form.secretaria_novo_nome}
                      onChange={(e) => setForm({ ...form, secretaria_novo_nome: e.target.value })}
                      className="flex-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                    />
                    <button type="button" onClick={() => { setNovaSecretaria(false); setForm({ ...form, secretaria_novo_nome: "" }); }} className="px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/50">
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Banco</label>
                {!novoBanco ? (
                  <select
                    value={form.banco_id}
                    onChange={(e) => {
                      if (e.target.value === "__novo__") setNovoBanco(true);
                      else setForm({ ...form, banco_id: e.target.value });
                    }}
                    className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                  >
                    <option value="">Selecione...</option>
                    {bancos.map((b) => (
                      <option key={b.id} value={b.id}>{b.nome}</option>
                    ))}
                    <option value="__novo__">+ Cadastrar novo banco</option>
                  </select>
                ) : (
                  <div className="flex gap-2 mt-1">
                    <input
                      type="text" placeholder="Nome do novo banco"
                      value={form.banco_novo_nome}
                      onChange={(e) => setForm({ ...form, banco_novo_nome: e.target.value })}
                      className="flex-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                    />
                    <button type="button" onClick={() => { setNovoBanco(false); setForm({ ...form, banco_novo_nome: "" }); }} className="px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/50">
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Nome da conta</label>
                <input
                  type="text" placeholder="Ex: Conta Movimento"
                  value={form.nome_conta}
                  onChange={(e) => setForm({ ...form, nome_conta: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Número da conta (opcional)</label>
                <input
                  type="text"
                  value={form.numero_conta}
                  onChange={(e) => setForm({ ...form, numero_conta: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Tipo (opcional)</label>
                <input
                  type="text" placeholder="Ex: custeio, investimento"
                  value={form.tipo_conta}
                  onChange={(e) => setForm({ ...form, tipo_conta: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Saldo inicial</label>
                <input
                  type="number" step="0.01" placeholder="0,00"
                  value={form.saldo_inicial}
                  onChange={(e) => setForm({ ...form, saldo_inicial: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Data do saldo</label>
                <input
                  type="date"
                  value={form.data_saldo}
                  onChange={(e) => setForm({ ...form, data_saldo: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
            </div>

            <button
              type="submit" disabled={salvando}
              className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90 disabled:opacity-50"
            >
              <Save size={15} />
              {salvando ? "Salvando..." : "Salvar conta"}
            </button>
          </form>
        )}
        {carregando ? (
          <div className="text-sm text-[#0F2A44]/50">Carregando...</div>
        ) : (
          <div className="space-y-4 print:space-y-2">
            {contasPorSecretaria.map((sec) => {
              const emLote = editandoSecretariaId === sec.id;
              return (
                <div key={sec.id} className="rounded-xl border border-black/5 overflow-hidden bg-white print:break-inside-avoid">
                  <div
                    className="flex items-center justify-between px-4 py-2.5"
                    style={{ backgroundColor: `${sec.cor}14`, borderLeft: `4px solid ${sec.cor}` }}
                  >
                    <span className="text-sm font-semibold" style={{ color: sec.cor }}>
                      {sec.nome.toUpperCase()}
                    </span>
                    <div className="flex items-center gap-3 print:hidden">
                      {emLote ? (
                        <>
                          <input
                            type="date"
                            value={dataLote}
                            onChange={(e) => setDataLote(e.target.value)}
                            className="px-2 py-1 rounded border border-black/10 text-xs"
                          />
                          <button
                            onClick={() => salvarLote(sec)}
                            disabled={salvando}
                            className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[#0F2A44] text-white"
                          >
                            <Save size={12} /> Salvar todos
                          </button>
                          <button
                            onClick={() => setEditandoSecretariaId(null)}
                            className="text-[#0F2A44]/40 hover:text-[#0F2A44]/70"
                          >
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          {sec.contas.length > 0 && (
                            <button
                              onClick={() => iniciarEdicaoLote(sec)}
                              className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-black/10"
                              style={{ color: sec.cor }}
                              title="Editar todos os saldos desta secretaria"
                            >
                              <Pencil size={12} /> Editar saldos
                            </button>
                          )}
                          <button
                            onClick={() => excluirSecretaria(sec.id, sec.nome)}
                            className="text-[#0F2A44]/30 hover:text-red-500"
                            title="Excluir secretaria"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {sec.contas.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-[#0F2A44]/40">
                      Nenhuma conta cadastrada nesta secretaria.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/40">
                          <th className="px-4 py-2 font-medium">Banco</th>
                                                    <th className="px-4 py-2 font-medium">Banco</th>
                          <th className="px-4 py-2 font-medium">Conta</th>
                          <th className="px-4 py-2 font-medium">Número</th>
                          <th className="px-4 py-2 font-medium text-center">Saldo</th>

                          <th className="px-4 py-2 font-medium text-center">Saldo</th>
                          <th className="px-4 py-2 font-medium text-right print:hidden">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sec.contas.map((c) => (
                          <tr key={c.id} className="border-t border-black/5">
                                                       <td className="px-4 py-2.5">{c.banco}</td>
                            <td className="px-4 py-2.5">{c.nome_conta}</td>
                            <td className="px-4 py-2.5 text-[#0F2A44]/60">{c.numero_conta || "--"}</td>
                            <td className="px-4 py-2.5 text-center tabular-nums">

                            <td className="px-4 py-2.5">{c.nome_conta}</td>
                            <td className="px-4 py-2.5 text-center tabular-nums">
                              {emLote ? (
                                <input
                                  type="number" step="0.01"
                                  value={saldosLote[c.id] ?? ""}
                                  onChange={(e) => setSaldosLote({ ...saldosLote, [c.id]: e.target.value })}
                                  className="w-28 px-2 py-1 rounded border border-black/10 text-xs text-center"
                                />
                              ) : editando === c.id ? (
                                <div className="flex items-center justify-center gap-2">
                                  <input
                                    type="date"
                                    value={novoSaldo.data}
                                    onChange={(e) => setNovoSaldo({ ...novoSaldo, data: e.target.value })}
                                    className="px-2 py-1 rounded border border-black/10 text-xs"
                                  />
                                  <input
                                    type="number" step="0.01" placeholder="0,00"
                                    value={novoSaldo.valor}
                                    onChange={(e) => setNovoSaldo({ ...novoSaldo, valor: e.target.value })}
                                    className="w-24 px-2 py-1 rounded border border-black/10 text-xs text-center"
                                  />
                                </div>
                              ) : (
                                formatBRL(c.saldo)
                              )}
                            </td>
                            <td className="px-4 py-2.5 print:hidden">
                              {!emLote && (
                                <div className="flex items-center justify-end gap-2">
                                  {editando === c.id ? (
                                    <>
                                      <button onClick={() => salvarNovoSaldo(c.id)} disabled={salvando} className="text-[#0F2A44] hover:text-[#0F2A44]/70">
                                        <Save size={15} />
                                      </button>
                                      <button onClick={() => setEditando(null)} className="text-[#0F2A44]/40 hover:text-[#0F2A44]/70">
                                        <X size={15} />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        onClick={() => { setEditando(c.id); setNovoSaldo({ valor: String(c.saldo), data: hojeISO() }); }}
                                        className="text-[#0F2A44]/50 hover:text-[#0F2A44]"
                                        title="Atualizar saldo"
                                      >
                                        <Pencil size={15} />
                                      </button>
                                      <button
                                        onClick={() => excluirConta(c.id)}
                                        className="text-[#0F2A44]/30 hover:text-red-500"
                                        title="Excluir conta"
                                      >
                                        <Trash2 size={15} />
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
