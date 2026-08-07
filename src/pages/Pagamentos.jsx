import React from "react";
import { Plus, X, Trash2, Check, ChevronRight, Pencil, Printer, FileText, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";
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
  const [fornecedoresDaSecretaria, setFornecedoresDaSecretaria] = React.useState([]);

  const [programacoesDoDia, setProgramacoesDoDia] = React.useState([]);
  const [programacaoAtualId, setProgramacaoAtualId] = React.useState(null);
  const [nomeNovaProgramacao, setNomeNovaProgramacao] = React.useState("");
  const [mostrarNovaProgramacao, setMostrarNovaProgramacao] = React.useState(false);

  const [contasSelecionadas, setContasSelecionadas] = React.useState(new Set());
  const [contasFinalizadas, setContasFinalizadas] = React.useState(false);
  const [pagamentos, setPagamentos] = React.useState([]);
  const [fechado, setFechado] = React.useState(false);

  const [comprometidoPorConta, setComprometidoPorConta] = React.useState({});

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
      carregarProgramacoesDoDia();
    }
  }, [secretariaId, data]);

  React.useEffect(() => {
    if (programacaoAtualId) {
      carregarProgramacaoAtual();
    } else {
      setContasSelecionadas(new Set());
      setPagamentos([]);
      setFechado(false);
      setContasFinalizadas(false);
    }
  }, [programacaoAtualId]);

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
        numero_conta: c.numero_conta,
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

  async function carregarProgramacoesDoDia() {
    setErro(null);
    try {
      const { data: progs, error } = await supabase
        .from("programacoes_pagamento")
        .select("id, nome_programacao, fechado, created_at")
        .eq("secretaria_id", secretariaId)
        .eq("data_programacao", data)
        .order("created_at", { ascending: true });
      if (error) throw error;

      setProgramacoesDoDia(progs ?? []);

      if (progs && progs.length > 0) {
        if (!progs.find((p) => p.id === programacaoAtualId)) {
          setProgramacaoAtualId(progs[0].id);
        }
      } else {
        setProgramacaoAtualId(null);
      }

      await calcularComprometidoPorConta(progs ?? []);
    } catch (e) {
      setErro(e.message ?? "Erro ao carregar programações do dia.");
    }
  }

  async function calcularComprometidoPorConta(progs) {
    if (!progs || progs.length === 0) {
      setComprometidoPorConta({});
      return;
    }
    try {
      const ids = progs.map((p) => p.id);

      const { data: pc, error: ePc } = await supabase
        .from("programacao_contas")
        .select("programacao_id, conta_id")
        .in("programacao_id", ids);
      if (ePc) throw ePc;

      const { data: pgs, error: ePgs } = await supabase
        .from("pagamentos")
        .select("programacao_id, valor_a_pagar")
        .in("programacao_id", ids)
        .neq("situacao", "cancelado");
      if (ePgs) throw ePgs;

      const totalPorProgramacao = {};
      for (const p of pgs ?? []) {
        totalPorProgramacao[p.programacao_id] =
          (totalPorProgramacao[p.programacao_id] ?? 0) + (parseFloat(p.valor_a_pagar) || 0);
      }

      const contasPorProgramacao = {};
      for (const r of pc ?? []) {
        if (!contasPorProgramacao[r.programacao_id]) contasPorProgramacao[r.programacao_id] = [];
        contasPorProgramacao[r.programacao_id].push(r.conta_id);
      }

      const comprometido = {};
      for (const progId of ids) {
        const contasDaProg = contasPorProgramacao[progId] ?? [];
        const totalDaProg = totalPorProgramacao[progId] ?? 0;
        if (contasDaProg.length === 0 || totalDaProg === 0) continue;
        const porConta = totalDaProg / contasDaProg.length;
        for (const contaId of contasDaProg) {
          comprometido[contaId] = { total: (comprometido[contaId]?.total ?? 0) + porConta };
          if (!comprometido[contaId].porProgramacao) comprometido[contaId].porProgramacao = {};
          comprometido[contaId].porProgramacao[progId] = porConta;
        }
      }
      setComprometidoPorConta(comprometido);
    } catch (e) {
      setErro(e.message ?? "Erro ao calcular saldos comprometidos.");
    }
  }

  async function carregarProgramacaoAtual() {
    setErro(null);
    try {
      const { data: prog, error: eProg } = await supabase
        .from("programacoes_pagamento")
        .select("id, fechado")
        .eq("id", programacaoAtualId)
        .single();
      if (eProg) throw eProg;

      setFechado(prog.fechado);

      const { data: pc, error: ePc } = await supabase
        .from("programacao_contas")
        .select("conta_id")
        .eq("programacao_id", programacaoAtualId);
      if (ePc) throw ePc;
      const setContas = new Set((pc ?? []).map((r) => r.conta_id));
      setContasSelecionadas(setContas);
      setContasFinalizadas(setContas.size > 0);

      const { data: pgs, error: ePgs } = await supabase
        .from("pagamentos")
        .select("id, fornecedor_id, valor_em_aberto_id, valor_a_pagar, situacao, nome_avulso, descricao, fornecedores(razao_social), valores_em_aberto(numero_nota_fiscal)")
        .eq("programacao_id", programacaoAtualId)
        .order("created_at", { ascending: true });
      if (ePgs) throw ePgs;
      setPagamentos(pgs ?? []);
    } catch (e) {
      setErro(e.message ?? "Erro ao carregar a programação selecionada.");
    }
  }

  async function criarProgramacao() {
    if (!nomeNovaProgramacao.trim()) {
      setErro("Dê um nome para a nova programação.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data: nova, error } = await supabase
        .from("programacoes_pagamento")
        .insert({
          secretaria_id: secretariaId,
          data_programacao: data,
          responsavel_id: userData.user.id,
          nome_programacao: nomeNovaProgramacao.trim(),
        })
        .select()
        .single();
      if (error) throw error;

      setNomeNovaProgramacao("");
      setMostrarNovaProgramacao(false);
      await carregarProgramacoesDoDia();
      setProgramacaoAtualId(nova.id);
    } catch (e) {
      setErro(e.message ?? "Erro ao criar programação.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluirProgramacao(progId) {
    if (!confirm("Excluir esta programação e todos os pagamentos lançados nela?")) return;
    setErro(null);
    try {
      await supabase.from("pagamentos").delete().eq("programacao_id", progId);
      await supabase.from("programacao_contas").delete().eq("programacao_id", progId);
      const { error } = await supabase.from("programacoes_pagamento").delete().eq("id", progId);
      if (error) throw error;
      setProgramacaoAtualId(null);
      await carregarProgramacoesDoDia();
    } catch (e) {
      setErro(e.message ?? "Erro ao excluir programação.");
    }
  }

  async function toggleConta(contaId) {
    if (!programacaoAtualId) {
      setErro("Crie ou selecione uma programação primeiro.");
      return;
    }
    setErro(null);
    try {
      const jaSelecionada = contasSelecionadas.has(contaId);

      if (jaSelecionada) {
        const { error } = await supabase
          .from("programacao_contas")
          .delete()
          .eq("programacao_id", programacaoAtualId)
          .eq("conta_id", contaId);
        if (error) throw error;
        const novas = new Set(contasSelecionadas);
        novas.delete(contaId);
        setContasSelecionadas(novas);
      } else {
        const { error } = await supabase
          .from("programacao_contas")
          .insert({ programacao_id: programacaoAtualId, conta_id: contaId });
        if (error) throw error;
        const novas = new Set(contasSelecionadas);
        novas.add(contaId);
        setContasSelecionadas(novas);
      }
      await carregarProgramacoesDoDia();
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
      const fornecedor = fornecedoresDaSecretaria.find((f) => f.id === fornecedorEscolhido);
      const valorObj = fornecedor?.valores.find((v) => v.id === valorEmAbertoEscolhido);
      const restante = (valorObj?.valor ?? 0) - (valorObj?.valor_pago ?? 0);

      const { error } = await supabase.from("pagamentos").insert({
        programacao_id: programacaoAtualId,
        fornecedor_id: fornecedorEscolhido,
        valor_em_aberto_id: valorEmAbertoEscolhido,
        valor_a_pagar: restante,
        situacao: "pendente",
      });
      if (error) throw error;

      setFornecedorEscolhido("");
      setValorEmAbertoEscolhido("");
      setMostrarAddCadastrado(false);
      await carregarProgramacaoAtual();
      await carregarProgramacoesDoDia();
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
      const { error } = await supabase.from("pagamentos").insert({
        programacao_id: programacaoAtualId,
        nome_avulso: avulso.nome,
        descricao: avulso.descricao || null,
        valor_a_pagar: parseFloat(avulso.valor),
        situacao: "pendente",
      });
      if (error) throw error;

      setAvulso({ nome: "", descricao: "", valor: "" });
      setMostrarAddAvulso(false);
      await carregarProgramacaoAtual();
      await carregarProgramacoesDoDia();
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
        await carregarProgramacoesDoDia();
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
      await carregarProgramacaoAtual();
      await carregarProgramacoesDoDia();
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
      await carregarProgramacaoAtual();
    } catch (e) {
      setErro(e.message ?? "Erro ao marcar como pago.");
    }
  }

  function exportarExcel() {
    const linhas = pagamentos.map((p) => ({
      Fornecedor: p.fornecedores?.razao_social ?? p.nome_avulso,
      Valor: p.valor_a_pagar,
      Situacao: p.situacao,
    }));
    const ws = XLSX.utils.json_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pagamentos");
    XLSX.writeFile(wb, `pagamentos-${data}.xlsx`);
  }

  const contasComSaldoDisponivelHoje = React.useMemo(() => {
    return contasDaSecretaria.map((c) => {
      const comprometidoOutras = Object.entries(
        comprometidoPorConta[c.id]?.porProgramacao ?? {}
      ).reduce((acc, [progId, valor]) => {
        if (progId === programacaoAtualId) return acc;
        return acc + valor;
      }, 0);
      return { ...c, saldoHoje: c.saldo - comprometidoOutras };
    });
  }, [contasDaSecretaria, comprometidoPorConta, programacaoAtualId]);

  const contasSelecionadasComSaldo = React.useMemo(() => {
    return contasComSaldoDisponivelHoje.filter((c) => contasSelecionadas.has(c.id));
  }, [contasComSaldoDisponivelHoje, contasSelecionadas]);

  const saldoDisponivel = React.useMemo(() => {
    return contasSelecionadasComSaldo.reduce((acc, c) => acc + c.saldoHoje, 0);
  }, [contasSelecionadasComSaldo]);

  const totalProgramado = React.useMemo(() => {
    return pagamentos.reduce((acc, p) => acc + (parseFloat(p.valor_a_pagar) || 0), 0);
  }, [pagamentos]);

  const saldoRestante = saldoDisponivel - totalProgramado;

  const todosValoresEmAberto = React.useMemo(() => {
    const fornecedor = fornecedoresDaSecretaria.find((f) => f.id === fornecedorEscolhido);
    return fornecedor?.valores ?? [];
  }, [fornecedoresDaSecretaria, fornecedorEscolhido]);

  return (
    <Layout>
      <div className="px-8 py-7 print:px-0 print:py-0">
        <div className="flex items-start justify-between mb-6 print:mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-[#0F2A44]">Pagamentos Diários</h1>
            <p className="text-sm text-[#0F2A44]/60 mt-0.5 print:hidden">
              {fechado ? "Programação fechada." : "Selecione ou crie uma programação para o dia"}
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
            <select
              value={secretariaId}
              onChange={(e) => { setSecretariaId(e.target.value); setProgramacaoAtualId(null); }}
              className="px-3 py-2 rounded-lg border border-black/10 text-sm bg-white"
            >
              {secretarias.map((s) => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))}
            </select>
            <input
              type="date"
              value={data}
              onChange={(e) => { setData(e.target.value); setProgramacaoAtualId(null); }}
              className="px-3 py-2 rounded-lg border border-black/10 text-sm bg-white"
            />
          </div>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-5 print:hidden">
            {erro}
          </div>
        )}

        {carregando ? (
          <div className="text-sm text-[#0F2A44]/50">Carregando...</div>
        ) : (
          <div>
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 mb-6 print:hidden">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-[#0F2A44]">Programações deste dia</h2>
                <button
                  onClick={() => setMostrarNovaProgramacao((v) => !v)}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[#0F2A44] text-white"
                >
                  {mostrarNovaProgramacao ? <X size={14} /> : <Plus size={14} />}
                  Nova programação
                </button>
              </div>

              {mostrarNovaProgramacao && (
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    placeholder="Ex: Manhã, Fornecedores urgentes..."
                    value={nomeNovaProgramacao}
                    onChange={(e) => setNomeNovaProgramacao(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                  />
                  <button
                    onClick={criarProgramacao}
                    disabled={salvando}
                    className="text-sm px-4 py-2 rounded-lg bg-[#0F2A44] text-white disabled:opacity-50"
                  >
                    Criar
                  </button>
                </div>
              )}

              {programacoesDoDia.length === 0 ? (
                <div className="text-xs text-[#0F2A44]/40">Nenhuma programação criada para este dia ainda.</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {programacoesDoDia.map((p) => (
                    <div key={p.id} className="flex items-center">
                      <button
                        onClick={() => setProgramacaoAtualId(p.id)}
                        className={`flex items-center gap-1.5 pl-3 pr-2 py-2 rounded-l-lg text-xs border ${
                          programacaoAtualId === p.id
                            ? "bg-[#0F2A44] text-white border-[#0F2A44]"
                            : "border-black/10 text-[#0F2A44]/70"
                        }`}
                      >
                        {programacaoAtualId === p.id && <ChevronRight size={12} />}
                        {p.nome_programacao || "Sem nome"}
                        {p.fechado && " (fechada)"}
                      </button>
                      <button
                        onClick={() => excluirProgramacao(p.id)}
                        className={`px-2 py-2 rounded-r-lg text-xs border border-l-0 ${
                          programacaoAtualId === p.id
                            ? "bg-[#0F2A44] text-white border-[#0F2A44]"
                            : "border-black/10 text-[#0F2A44]/40"
                        }`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {programacaoAtualId && (
              <>
                <div className="grid grid-cols-3 gap-4 mb-6 print:mb-4 print:break-inside-avoid">
                  <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
                    <div className="text-xs text-[#0F2A44]/50">Saldo disponível</div>
                    <div className="text-xl font-semibold text-[#0F2A44] mt-1">{formatBRL(saldoDisponivel)}</div>
                  </div>
                  <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
                    <div className="text-xs text-[#0F2A44]/50">Total programado</div>
                    <div className="text-xl font-semibold text-[#0F2A44] mt-1">{formatBRL(totalProgramado)}</div>
                  </div>
                  <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
                    <div className="text-xs text-[#0F2A44]/50">Saldo restante (resta)</div>
                    <div
                      className="text-xl font-semibold mt-1"
                      style={{ color: saldoRestante < 0 ? "#DC2626" : "#0F2A44" }}
                    >
                      {formatBRL(saldoRestante)}
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-6 print:break-inside-avoid">
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-sm font-semibold text-[#0F2A44]">Contas bancárias desta programação</h2>
                    {!contasFinalizadas ? (
                      <button
                        onClick={() => setContasFinalizadas(true)}
                        disabled={contasSelecionadas.size === 0}
                        className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[#0F2A44] text-white disabled:opacity-40 print:hidden"
                      >
                        <Check size={13} /> Finalizar escolha
                      </button>
                    ) : (
                      <button
                        onClick={() => setContasFinalizadas(false)}
                        className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44] print:hidden"
                      >
                        <Pencil size={13} /> Editar contas
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-[#0F2A44]/50 mb-3 print:hidden">
                    O saldo já considera o que outras programações de hoje reservaram nas mesmas contas.
                  </p>

                  {!contasFinalizadas ? (
                    contasComSaldoDisponivelHoje.length === 0 ? (
                      <div className="text-xs text-[#0F2A44]/40">Nenhuma conta cadastrada para esta secretaria.</div>
                    ) : (
                      <div className="divide-y divide-black/5">
                        {contasComSaldoDisponivelHoje.map((c) => {
                          const selecionada = contasSelecionadas.has(c.id);
                          return (
                            <label key={c.id} className="flex items-center justify-between py-2.5 cursor-pointer">
                              <div className="flex items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={selecionada}
                                  onChange={() => toggleConta(c.id)}
                                  className="w-4 h-4 rounded accent-[#0F2A44]"
                                />
                                <span className="text-sm text-[#0F2A44]">{c.banco} · {c.nome_conta}</span>
                              </div>
                              <span className="text-sm tabular-nums text-[#0F2A44]/70">{formatBRL(c.saldoHoje)}</span>
                            </label>
                          );
                        })}
                      </div>
                    )
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/40 border-b border-black/5">
                          <th className="py-2 font-medium">Instituição</th>
                          <th className="py-2 font-medium">Conta Nº</th>
                          <th className="py-2 font-medium">Objeto</th>
                          <th className="py-2 font-medium text-right">Saldo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contasSelecionadasComSaldo.map((c) => (
                          <tr key={c.id} className="border-b border-black/5">
                            <td className="py-2">{c.banco}</td>
                            <td className="py-2 text-[#0F2A44]/70">{c.numero_conta || "--"}</td>
                            <td className="py-2">{c.nome_conta}</td>
                            <td className="py-2 text-right tabular-nums">{formatBRL(c.saldoHoje)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-[#0F2A44]/[0.03]">
                          <td colSpan={3} className="py-2.5 font-semibold text-[#0F2A44]">TOTAL SALDO</td>
                          <td className="py-2.5 text-right font-semibold text-[#0F2A44]">{formatBRL(saldoDisponivel)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>

                <div className="flex items-center gap-2 mb-4 print:hidden">
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
                  <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-6 space-y-3 print:hidden">
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
                  <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-6 space-y-3 print:hidden">
                    <h3 className="text-sm font-semibold text-[#0F2A44]">Adicionar fornecedor não cadastrado</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="text" placeholder="Nome"
                        value={avulso.nome}
                        onChange={(e) => setAvulso({ ...avulso, nome: e.target.value })}
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

                <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden print:break-inside-avoid">
                  <div className="px-5 py-3 border-b border-black/5">
                    <h2 className="text-sm font-semibold text-[#0F2A44]">Pagamentos desta programação</h2>
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
                          <th className="px-5 py-2 font-medium text-right">Valor a pagar</th>
                          <th className="px-5 py-2 font-medium text-center">Situação</th>
                          <th className="px-5 py-2 font-medium text-right print:hidden">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagamentos.map((p) => (
                          <tr key={p.id} className="border-b border-black/5">
                            <td className="px-5 py-2.5">
                              {p.fornecedores?.razao_social ?? p.nome_avulso}
                              {!p.fornecedor_id && (
                                <span className="ml-1.5 text-[10px] uppercase text-[#EA9A1E] bg-[#FFF6E5] px-1.5 py-0.5 rounded print:hidden">
                                  não cadastrado
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-2.5 text-right">
                              <input
                                type="number" step="0.01"
                                value={p.valor_a_pagar}
                                onChange={(e) => editarValorLocal(p.id, e.target.value)}
                                className="w-28 px-2 py-1 rounded border border-black/10 text-sm text-right tabular-nums print:border-none print:w-auto"
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
                                  className="text-xs font-medium text-[#0F2A44]/60 hover:text-[#0F2A44] border border-black/10 px-2 py-1 rounded-md print:hidden"
                                >
                                  Marcar como pago
                                </button>
                              )}
                            </td>
                            <td className="px-5 py-2.5 text-right print:hidden">
                              <button onClick={() => removerPagamento(p.id)} className="text-[#0F2A44]/30 hover:text-red-500">
                                <Trash2 size={15} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-[#0F2A44]/[0.03]">
                          <td className="px-5 py-3 text-sm font-semibold text-[#0F2A44]">TOTAL</td>
                          <td className="px-5 py-3 text-right text-sm font-semibold text-[#0F2A44]">
                            {formatBRL(totalProgramado)}
                          </td>
                          <td colSpan={2} />
                        </tr>
                        <tr>
                          <td className="px-5 py-3 text-sm font-semibold text-[#0F2A44]">RESTA</td>
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
        )}
      </div>
    </Layout>
  );
}
