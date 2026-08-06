import React from "react";
import { Plus, X, Pencil, Save } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import Layout from "../components/Layout";

function formatBRL(v) {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function hojeISO() {
  return new Date().toISOString().slice(0, 10);
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

      const agrupado = (secs ?? []).map((sec) => {
        const contasDaSec = (contas ?? [])
          .filter((c) => c.secretaria_id === sec.id)
          .map((c) => ({
            id: c.id,
            banco: c.bancos?.nome ?? "--",
            nome_conta: c.nome_conta,
            numero_conta: c.numero_conta,
            saldo: ultimoSaldo[c.id]?.valor_saldo ?? 0,
            data_saldo: ultimoSaldo[c.id]?.data_saldo ?? null,
          }));
        const total = contasDaSec.reduce((acc, c) => acc + c.saldo, 0);
        return { id: sec.id, nome: sec.nome, contas: contasDaSec, total };
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
  async function criarConta(e) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      let secretariaId = form.secretaria_id;
      let bancoId = form.banco_id;

      if (novaSecretaria && form.secretaria_novo_nome.trim()) {
        const { data: secData, error: eSec } = await supabase
          .from("secretarias")
          .insert({ nome: form.secretaria_novo_nome.trim() })
          .select()
          .single();
        if (eSec) throw eSec;
        secretariaId = secData.id;
      }

      if (novoBanco && form.banco_novo_nome.trim()) {
        const { data: bancoData, error: eBanco } = await supabase
          .from("bancos")
          .insert({ nome: form.banco_novo_nome.trim() })
          .select()
          .single();
        if (eBanco) throw eBanco;
        bancoId = bancoData.id;
      }

      if (!secretariaId || !bancoId || !form.nome_conta) {
        throw new Error("Preencha secretaria, banco e nome da conta.");
      }

      const { data: contaData, error: eConta } = await supabase
        .from("contas_bancarias")
        .insert({
          secretaria_id: secretariaId,
          banco_id: bancoId,
          nome_conta: form.nome_conta,
          numero_conta: form.numero_conta || null,
          tipo_conta: form.tipo_conta || null,
        })
        .select()
        .single();
      if (eConta) throw eConta;

      const valorInicial = parseFloat(form.saldo_inicial || "0");
      const { error: eSaldo } = await supabase.from("saldos_historico").insert({
        conta_id: contaData.id,
        valor_saldo: valorInicial,
        data_saldo: form.data_saldo,
      });
      if (eSaldo) throw eSaldo;

      setForm({
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

  const totalGeral = contasPorSecretaria.reduce((acc, s) => acc + s.total, 0);
  return (
    <Layout>
      <div className="px-8 py-7">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-[#0F2A44]">Saldos das Contas</h1>
            <p className="text-sm text-[#0F2A44]/60 mt-0.5">
              Total geral: <span className="font-semibold">{formatBRL(totalGeral)}</span>
            </p>
          </div>
          <button
            onClick={() => setMostrarForm((v) => !v)}
            className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90"
          >
            {mostrarForm ? <X size={16} /> : <Plus size={16} />}
            {mostrarForm ? "Cancelar" : "Novo Registro"}
          </button>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-5">
            {erro}
          </div>
        )}

        {mostrarForm && (
          <form
            onSubmit={criarConta}
            className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-6 space-y-4"
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
                      type="text"
                      placeholder="Nome da nova secretaria"
                      value={form.secretaria_novo_nome}
                      onChange={(e) => setForm({ ...form, secretaria_novo_nome: e.target.value })}
                      className="flex-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => { setNovaSecretaria(false); setForm({ ...form, secretaria_novo_nome: "" }); }}
                      className="px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/50"
                    >
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
                      type="text"
                      placeholder="Nome do novo banco"
                      value={form.banco_novo_nome}
                      onChange={(e) => setForm({ ...form, banco_novo_nome: e.target.value })}
                      className="flex-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => { setNovoBanco(false); setForm({ ...form, banco_novo_nome: "" }); }}
                      className="px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/50"
                    >
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
                  type="text"
                  placeholder="Ex: Conta Movimento"
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
                  type="text"
                  placeholder="Ex: custeio, investimento"
                  value={form.tipo_conta}
                  onChange={(e) => setForm({ ...form, tipo_conta: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#0F2A44]/70">Saldo inicial</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0,00"
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
              type="submit"
              disabled={salvando}
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
          <div className="space-y-4">
            {contasPorSecretaria.map((sec) => (
              <div key={sec.id} className="rounded-xl border border-black/5 overflow-hidden bg-white">
                <div className="flex items-center justify-between px-4 py-2.5 bg-[#0F2A44]/5 border-b border-black/5">
                  <span className="text-sm font-semibold text-[#0F2A44]">{sec.nome.toUpperCase()}</span>
                  <span className="text-sm font-semibold text-[#0F2A44]">Total: {formatBRL(sec.total)}</span>
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
                        <th className="px-4 py-2 font-medium">Conta</th>
                        <th className="px-4 py-2 font-medium">Data do saldo</th>
                        <th className="px-4 py-2 font-medium text-right">Saldo</th>
                        <th className="px-4 py-2 font-medium text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sec.contas.map((c) => (
                        <tr key={c.id} className="border-t border-black/5">
                          <td className="px-4 py-2.5">{c.banco}</td>
                          <td className="px-4 py-2.5">{c.nome_conta}</td>
                          <td className="px-4 py-2.5 text-[#0F2A44]/60">
                            {c.data_saldo ? new Date(c.data_saldo + "T00:00:00").toLocaleDateString("pt-BR") : "--"}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {editando === c.id ? (
                              <div className="flex items-center justify-end gap-2">
                                <input
                                  type="date"
                                  value={novoSaldo.data}
                                  onChange={(e) => setNovoSaldo({ ...novoSaldo, data: e.target.value })}
                                  className="px-2 py-1 rounded border border-black/10 text-xs"
                                />
                                <input
                                  type="number"
                                  step="0.01"
                                  placeholder="0,00"
                                  value={novoSaldo.valor}
                                  onChange={(e) => setNovoSaldo({ ...novoSaldo, valor: e.target.value })}
                                  className="w-24 px-2 py-1 rounded border border-black/10 text-xs text-right"
                                />
                              </div>
                            ) : (
                              formatBRL(c.saldo)
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center justify-end gap-2">
                              {editando === c.id ? (
                                <>
                                  <button
                                    onClick={() => salvarNovoSaldo(c.id)}
                                    disabled={salvando}
                                    className="text-[#0F2A44] hover:text-[#0F2A44]/70"
                                  >
                                    <Save size={15} />
                                  </button>
                                  <button
                                    onClick={() => setEditando(null)}
                                    className="text-[#0F2A44]/40 hover:text-[#0F2A44]/70"
                                  >
                                    <X size={15} />
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => {
                                    setEditando(c.id);
                                    setNovoSaldo({ valor: String(c.saldo), data: hojeISO() });
                                  }}
                                  className="text-[#0F2A44]/50 hover:text-[#0F2A44]"
                                  title="Atualizar saldo"
                                >
                                  <Pencil size={15} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
