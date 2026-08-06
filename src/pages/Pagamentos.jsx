import React from "react";
import { Plus, X, Trash2, Check, ChevronDown } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import Layout from "../components/Layout";

function formatBRL(v) {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function Pagamentos() {
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);

  const [secretarias, setSecretarias] = React.useState([]);
  const [secretariaId, setSecretariaId] = React.useState("");
  const [data, setData] = React.useState(hojeISO());

  const [contasDaSecretaria, setContasDaSecretaria] = React.useState([]);
  const [contasSelecionadas, setContasSelecionadas] = React.useState(new Set());

  const [fornecedoresDaSecretaria, setFornecedoresDaSecretaria] = React.useState([]);

  const [programacaoId, setProgramacaoId] = React.useState(null);
  const [fechado, setFechado] = React.useState(false);
  const [pagamentos, setPagamentos] = React.useState([]);

  const [mostrarAddCadastrado, setMostrarAddCadastrado] = React.useState(false);
  const [mostrarAddAvulso, setMostrarAddAvulso] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);

  const [fornecedorEscolhido, setFornecedorEscolhido] = React.useState("");
  const [valorEmAbertoEscolhido, setValorEmAbertoEscolhido] = React.useState("");

  const [avulso, setAvulso] = React.useState({ nome: "", descricao: "", valor: "" });

  const timersRef = React.useRef({});

  React.useEffect(() => {
    carregarSecretarias();
  }, []);

  React.useEffect(() => {
    if (secretariaId) {
      carregarContasEFornecedores(secretariaId);
    } else {
      setContasDaSecretaria([]);
      setFornecedoresDaSecretaria([]);
    }
  }, [secretariaId]);

  React.useEffect(() => {
    if (secretariaId && data) {
      carregarProgramacao();
    }
  }, [secretariaId, data]);

  async function carregarSecretarias() {
    try {
      const { data: secs, error } = await supabase
        .from("secretarias").select("id, nome").eq("ativo", true).order("nome");
      if (error) throw error;
      setSecretarias(secs ?? []);
      if (secs && secs.length > 0 && !secretariaId) {
        setSecretariaId(secs[0].id);
      }
    } catch (e) {
      setErro(e.message ?? "Erro ao carregar secretarias.");
    } finally {
      setCarregando(false);
    }
  }
  async function carregarContasEFornecedores(secId) {
    try {
      const { data: contas, error: eContas } = await supabase
        .from("contas_bancarias")
        .select("id, nome_conta, numero_conta, banco_id, bancos(nome)")
        .eq("secretaria_id", secId)
        .eq("ativo", true);
      if (eContas) throw eContas;

      const { data: saldos, error: eSaldos } = await supabase
        .from("saldos_historico")
        .select("conta_id, valor_saldo, data_saldo")
        .order("data_saldo", { ascending: false });
      if (eSaldos) throw eSaldos;

      const ultimoSaldo = {};
      for (const s of saldos ?? []) {
        if (!(s.conta_id in ultimoSaldo)) ultimoSaldo[s.conta_id] = s.valor_saldo;
      }

      const contasComSaldo = (contas ?? []).map((c) => ({
        id: c.id,
        nome_conta: c.nome_conta,
        banco: c.bancos?.nome ?? "--",
        saldo: ultimoSaldo[c.id] ?? 0,
      }));
      setContasDaSecretaria(contasComSaldo);

      const { data: forns, error: eForns } = await supabase
        .from("fornecedores")
        .select("id, razao_social")
        .eq("secretaria_id", secId)
        .eq("ativo", true)
        .order("razao_social");
      if (eForns) throw eForns;

      const { data: valores, error: eValores } = await supabase
        .from("valores_em_aberto")
        .select("id, fornecedor_id, numero_nota_fiscal, valor, valor_pago, situacao")
        .in("situacao", ["em_aberto", "programado", "parcialmente_pago"]);
      if (eValores) throw eValores;

      const fornsComValores = (forns ?? []).map((f) => ({
        ...f,
        valores: (valores ?? []).filter((v) => v.fornecedor_id === f.id),
      }));
      setFornecedoresDaSecretaria(fornsComValores);
    } catch (e) {
      setErro(e.message ?? "Erro ao carregar contas e fornecedores.");
    }
  }

  async function carregarProgramacao() {
    setErro(null);
    try {
      const { data: prog, error: eProg } = await supabase
        .from("programacoes_pagamento")
        .select("id, fechado")
        .eq("secretaria_id", secretariaId)
        .eq("data_programacao", data)
        .maybeSingle();
      if (eProg) throw eProg;

      if (!prog) {
        setProgramacaoId(null);
        setFechado(false);
        setContasSelecionadas(new Set());
        setPagamentos([]);
        return;
      }

      setProgramacaoId(prog.id);
      setFechado(prog.fechado);

      const { data: pc, error: ePc } = await supabase
        .from("programacao_contas")
        .select("conta_id")
        .eq("programacao_id", prog.id);
      if (ePc) throw ePc;
      setContasSelecionadas(new Set((pc ?? []).map((r) => r.conta_id)));

      const { data: pgs, error: ePgs } = await supabase
        .from("pagamentos")
        .select("id, fornecedor_id, valor_em_aberto_id, valor_a_pagar, situacao, nome_avulso, descricao, fornecedores(razao_social), valores_em_aberto(numero_nota_fiscal)")
        .eq("programacao_id", prog.id)
        .order("created_at", { ascending: true });
      if (ePgs) throw ePgs;
      setPagamentos(pgs ?? []);
    } catch (e) {
      setErro(e.message ?? "Erro ao carregar programação do dia.");
    }
  }

  async function garantirProgramacao() {
    if (programacaoId) return programacaoId;
    const { data: userData } = await supabase.auth.getUser();
    const { data: nova, error } = await supabase
      .from("programacoes_pagamento")
      .insert({ secretaria_id: secretariaId, data_programacao: data, responsavel_id: userData.user.id })
      .select()
      .single();
    if (error) throw error;
    setProgramacaoId(nova.id);
    return nova.id;
  }
  async function toggleConta(contaId) {
    setErro(null);
    try {
      const progId = await garantirProgramacao();
      const jaSelecionada = contasSelecionadas.has(contaId);

      if (jaSelecionada) {
        const { error } = await supabase
          .from("programacao_contas")
          .delete()
          .eq("programacao_id", progId)
          .eq("conta_id", contaId);
        if (error) throw error;
        const novas = new Set(contasSelecionadas);
        novas.delete(contaId);
        setContasSelecionadas(novas);
      } else {
        const { error } = await supabase
          .from("programacao_contas")
          .insert({ programacao_id: progId, conta_id: contaId });
        if (error) throw error;
        const novas = new Set(contasSelecionadas);
        novas.add(contaId);
        setContasSelecionadas(novas);
      }
    } catch (e) {
      setErro(e.message ?? "Erro ao selecionar conta.");
    }
  }

  async function adicionarPagamentoCadastrado() {
    if (!fornecedorEscolhido || !valorEmAbertoEscolhido) {
      setErro("Selecione o fornecedor e o valor em aberto.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const progId = await garantirProgramacao();
      const fornecedor = fornecedoresDaSecretaria.find((f) => f.id === fornecedorEscolhido);
      const valorObj = fornecedor?.valores.find((v) => v.id === valorEmAbertoEscolhido);
      const restante = (valorObj?.valor ?? 0) - (valorObj?.valor_pago ?? 0);

      const { error } = await supabase.from("pagamentos").insert({
        programacao_id: progId,
        fornecedor_id: fornecedorEscolhido,
        valor_em_aberto_id: valorEmAbertoEscolhido,
        valor_a_pagar: restante,
        situacao: "pendente",
      });
      if (error) throw error;

      setFornecedorEscolhido("");
      setValorEmAbertoEscolhido("");
      setMostrarAddCadastrado(false);
      await carregarProgramacao();
    } catch (e) {
      setErro(e.message ?? "Erro ao adicionar pagamento.");
    } finally {
      setSalvando(false);
    }
  }

  async function adicionarAvulso() {
    if (!avulso.nome || !avulso.valor) {
      setErro("Informe o nome e o valor.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const progId = await garantirProgramacao();
      const { error } = await supabase.from("pagamentos").insert({
        programacao_id: progId,
        nome_avulso: avulso.nome,
        descricao: avulso.descricao || null,
        valor_a_pagar: parseFloat(avulso.valor),
        situacao: "pendente",
      });
      if (error) throw error;

      setAvulso({ nome: "", descricao: "", valor: "" });
      setMostrarAddAvulso(false);
      await carregarProgramacao();
    } catch (e) {
      setErro(e.message ?? "Erro ao adicionar pagamento avulso.");
    } finally {
      setSalvando(false);
    }
  }
  function editarValorLocal(pagamentoId, novoValor) {
    setPagamentos((atual) =>
      atual.map((p) => (p.id === pagamentoId ? { ...p, valor_a_pagar: novoValor } : p))
    );

    clearTimeout(timersRef.current[pagamentoId]);
    timersRef.current[pagamentoId] = setTimeout(async () => {
      try {
        const valor = parseFloat(novoValor || "0");
        const { error } = await supabase
          .from("pagamentos")
          .update({ valor_a_pagar: valor })
          .eq("id", pagamentoId);
        if (error) throw error;
      } catch (e) {
        setErro(e.message ?? "Erro ao salvar valor.");
      }
    }, 600);
  }

  async function removerPagamento(pagamentoId) {
    setErro(null);
    try {
      const { error } = await supabase.from("pagamentos").delete().eq("id", pagamentoId);
      if (error) throw error;
      await carregarProgramacao();
    } catch (e) {
      setErro(e.message ?? "Erro ao remover pagamento.");
    }
  }

  async function marcarPago(pagamentoId) {
    setErro(null);
    try {
      const { error } = await supabase
        .from("pagamentos")
        .update({ situacao: "pago" })
        .eq("id", pagamentoId);
      if (error) throw error;
      await carregarProgramacao();
    } catch (e) {
      setErro(e.message ?? "Erro ao marcar como pago.");
    }
  }

  const saldoDisponivel = React.useMemo(() => {
    return contasDaSecretaria
      .filter((c) => contasSelecionadas.has(c.id))
      .reduce((acc, c) => acc + c.saldo, 0);
  }, [contasDaSecretaria, contasSelecionadas]);

  const totalProgramado = React.useMemo(() => {
    return pagamentos.reduce((acc, p) => acc + (parseFloat(p.valor_a_pagar) || 0), 0);
  }, [pagamentos]);

  const saldoRestante = saldoDisponivel - totalProgramado;

  const todosValoresEmAberto = React.useMemo(() => {
    const fornecedor = fornecedoresDaSecretaria.find((f) => f.id === fornecedorEscolhido);
    return fornecedor?.valores ?? [];
  }, [fornecedoresDaSecretaria, fornecedorEscolhido]);
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={() => { setMostrarAddCadastrado((v) => !v); setMostrarAddAvulso(false); }}
                className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border border-black/10 text-[#0F2A44] hover:bg-black/5"
              >
                {mostrarAddCadastrado ? <X size={16} /> : <Plus size={16} />}
                Fornecedor cadastrado
              </button>
              <button
                onClick={() => { setMostrarAddAvulso((v) => !v); setMostrarAddCadastrado(false); }}
                className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border border-black/10 text-[#0F2A44] hover:bg-black/5"
              >
                {mostrarAddAvulso ? <X size={16} /> : <Plus size={16} />}
                Fornecedor não cadastrado
              </button>
            </div>

            {mostrarAddCadastrado && (
              <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-6 space-y-3">
                <h3 className="text-sm font-semibold text-[#0F2A44]">Adicionar pagamento de fornecedor cadastrado</h3>
                <div className="grid grid-cols-2 gap-3">
                  <select
                    value={fornecedorEscolhido}
                    onChange={(e) => { setFornecedorEscolhido(e.target.value); setValorEmAbertoEscolhido(""); }}
                    className="px-3 py-2 rounded-lg border border-black/10 text-sm"
                  >
                    <option value="">Selecione o fornecedor...</option>
                    {fornecedoresDaSecretaria.map((f) => (
                      <option key={f.id} value={f.id}>{f.razao_social}</option>
                    ))}
                  </select>
                  <select
                    value={valorEmAbertoEscolhido}
                    onChange={(e) => setValorEmAbertoEscolhido(e.target.value)}
                    disabled={!fornecedorEscolhido}
                    className="px-3 py-2 rounded-lg border border-black/10 text-sm disabled:opacity-50"
                  >
                    <option value="">Selecione o valor em aberto...</option>
                    {todosValoresEmAberto.map((v) => (
                      <option key={v.id} value={v.id}>
                        NF {v.numero_nota_fiscal || "--"} -- {formatBRL(v.valor - (v.valor_pago ?? 0))}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={adicionarPagamentoCadastrado}
                  disabled={salvando}
                  className="text-sm px-4 py-2 rounded-lg bg-[#0F2A44] text-white disabled:opacity-50"
                >
                  {salvando ? "Adicionando..." : "Adicionar à programação"}
                </button>
              </div>
            )}

            {mostrarAddAvulso && (
              <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-6 space-y-3">
                <h3 className="text-sm font-semibold text-[#0F2A44]">Adicionar fornecedor não cadastrado</h3>
                <div className="grid grid-cols-3 gap-3">
                  <input
                    type="text" placeholder="Nome"
                    value={avulso.nome}
                    onChange={(e) => setAvulso({ ...avulso, nome: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-black/10 text-sm"
                  />
                  <input
                    type="text" placeholder="Descrição (opcional)"
                    value={avulso.descricao}
                    onChange={(e) => setAvulso({ ...avulso, descricao: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-black/10 text-sm"
                  />
                  <input
                    type="number" step="0.01" placeholder="Valor"
                    value={avulso.valor}
                    onChange={(e) => setAvulso({ ...avulso, valor: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-black/10 text-sm"
                  />
                </div>
                <button
                  onClick={adicionarAvulso}
                  disabled={salvando}
                  className="text-sm px-4 py-2 rounded-lg bg-[#0F2A44] text-white disabled:opacity-50"
                >
                  {salvando ? "Adicionando..." : "Adicionar à programação"}
                </button>
              </div>
            )}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-black/5">
                <h2 className="text-sm font-semibold text-[#0F2A44]">Pagamentos do dia</h2>
              </div>
              {pagamentos.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-[#0F2A44]/40">
                  Nenhum pagamento adicionado ainda.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/40 border-b border-black/5">
                      <th className="px-5 py-2 font-medium">Fornecedor</th>
                      <th className="px-5 py-2 font-medium">Referência</th>
                      <th className="px-5 py-2 font-medium text-right">Valor a pagar</th>
                      <th className="px-5 py-2 font-medium text-center">Situação</th>
                      <th className="px-5 py-2 font-medium text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagamentos.map((p) => (
                      <tr key={p.id} className="border-b border-black/5">
                        <td className="px-5 py-2.5">
                          {p.fornecedores?.razao_social ?? p.nome_avulso}
                          {!p.fornecedor_id && (
                            <span className="ml-1.5 text-[10px] uppercase text-[#EA9A1E] bg-[#FFF6E5] px-1.5 py-0.5 rounded">
                              não cadastrado
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-2.5 text-xs text-[#0F2A44]/60">
                          {p.valores_em_aberto?.numero_nota_fiscal
                            ? `NF ${p.valores_em_aberto.numero_nota_fiscal}`
                            : p.descricao || "--"}
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          <input
                            type="number" step="0.01"
                            value={p.valor_a_pagar}
                            onChange={(e) => editarValorLocal(p.id, e.target.value)}
                            className="w-28 px-2 py-1 rounded border border-black/10 text-sm text-right tabular-nums"
                          />
                        </td>
                        <td className="px-5 py-2.5 text-center">
                          {p.situacao === "pago" ? (
                            <span className="text-xs font-medium text-[#16A34A] bg-[#EAFBF0] px-2 py-1 rounded-md">
                              Pago
                            </span>
                          ) : (
                            <button
                              onClick={() => marcarPago(p.id)}
                              className="text-xs font-medium text-[#0F2A44]/60 hover:text-[#0F2A44] border border-black/10 px-2 py-1 rounded-md"
                            >
                              Marcar como pago
                            </button>
                          )}
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          <button
                            onClick={() => removerPagamento(p.id)}
                            className="text-[#0F2A44]/30 hover:text-red-500"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#0F2A44]/[0.03]">
                      <td colSpan={2} className="px-5 py-3 text-sm font-semibold text-[#0F2A44]">TOTAL</td>
                      <td className="px-5 py-3 text-right text-sm font-semibold text-[#0F2A44]">
                        {formatBRL(totalProgramado)}
                      </td>
                      <td colSpan={2} />
                    </tr>
                    <tr>
                      <td colSpan={2} className="px-5 py-3 text-sm font-semibold text-[#0F2A44]">RESTA</td>
                      <td
                        className="px-5 py-3 text-right text-sm font-semibold"
                        style={{ color: saldoRestante < 0 ? "#DC2626" : "#0F2A44" }}
                      >
                        {formatBRL(saldoRestante)}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
