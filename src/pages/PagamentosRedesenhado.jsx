import React from "react";
import { AlertTriangle, Check, FileDown, Plus, Printer, Search, Trash2, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import Layout from "../components/Layout";
import CampoMoeda from "../components/CampoMoeda";
import { formatBRL } from "../lib/moeda";
import { mensagemAmigavel } from "../lib/erros";
import { carregarSaldosDasContas } from "../lib/saldosContasDados";
import { usePermissaoModulo } from "../lib/permissoes";
import { gerarPdfProgramacao, imprimirProgramacao } from "../lib/programacaoDocumento";
import { alternarSelecao, calcularRestante, definirValorProgramado, selecionarTodosVisiveis, somarContasSelecionadas, somarPagamentos, valorPlanejamento } from "../lib/planejamentoPagamentos";

const hojeISO = () => {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
};
const numero = (valor) => valorPlanejamento(valor);
const dataBR = (valor) => new Date(`${valor}T00:00:00`).toLocaleDateString("pt-BR");
const nomeAutomatico = (data) => `PROGRAMAÇÃO DIÁRIA — ${dataBR(data)}`;
const textoConta = (conta) => `${conta.banco} ${conta.numero_conta} ${conta.nome_conta}`.toLocaleLowerCase("pt-BR");

function nomePagamento(pagamento) {
  return pagamento.fornecedores?.razao_social || pagamento.nome_avulso || "Fornecedor avulso";
}

function statusLabel(status, fechado = false) {
  if (fechado) return "HISTÓRICO";
  return status === "em_analise" ? "EM ANÁLISE" : "EM ELABORAÇÃO";
}

export default function PagamentosRedesenhado() {
  const { permissao, usuario } = usePermissaoModulo("pagamentos");
  const podeEditar = permissao?.pode_editar !== false;
  const [carregando, setCarregando] = React.useState(true);
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState("");
  const [mensagem, setMensagem] = React.useState("");
  const [secretarias, setSecretarias] = React.useState([]);
  const [secretariaId, setSecretariaId] = React.useState("");
  const [data, setData] = React.useState(hojeISO());
  const [programacoes, setProgramacoes] = React.useState([]);
  const [programacaoId, setProgramacaoId] = React.useState("");
  const [programacao, setProgramacao] = React.useState(null);
  const [contas, setContas] = React.useState([]);
  const [contasSelecionadas, setContasSelecionadas] = React.useState(new Set());
  const [buscaConta, setBuscaConta] = React.useState("");
  const [fornecedores, setFornecedores] = React.useState([]);
  const [buscaFornecedor, setBuscaFornecedor] = React.useState("");
  const [pagamentos, setPagamentos] = React.useState([]);
  const [mostrarAvulso, setMostrarAvulso] = React.useState(false);
  const [avulso, setAvulso] = React.useState({ nome: "", valor: 0, cadastrarDepois: false });
  const podeEditarProgramacao = podeEditar && programacao?.fechado !== true;

  React.useEffect(() => {
    carregarSecretarias();
  }, []);

  React.useEffect(() => {
    if (!secretariaId) return;
    carregarBase();
    carregarProgramacoes();
  }, [secretariaId, data]);

  React.useEffect(() => {
    if (programacaoId) carregarProgramacao(programacaoId);
    else limparEdicao();
  }, [programacaoId]);

  async function carregarSecretarias() {
    try {
      const { data: itens, error } = await supabase.from("secretarias").select("id, nome").eq("ativo", true).order("nome");
      if (error) throw error;
      setSecretarias(itens ?? []);
      setSecretariaId(itens?.[0]?.id || "");
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível carregar as secretarias."));
    } finally {
      setCarregando(false);
    }
  }

  async function carregarBase() {
    setErro("");
    try {
      const [{ data: contasBrutas, error: erroContas }, { data: fornecedoresAtivos, error: erroFornecedores }] = await Promise.all([
        supabase.from("contas_bancarias").select("id, nome_conta, numero_conta, secretaria_id, bancos(nome)").eq("secretaria_id", secretariaId).eq("ativo", true),
        supabase.from("fornecedores").select("id, razao_social").eq("secretaria_id", secretariaId).eq("ativo", true).order("razao_social"),
      ]);
      if (erroContas) throw erroContas;
      if (erroFornecedores) throw erroFornecedores;

      const nomeSecretaria = secretarias.find((item) => String(item.id) === String(secretariaId))?.nome || "--";
      const { contas: contasComSaldo } = await carregarSaldosDasContas({
        contas: (contasBrutas ?? []).map((conta) => ({
          id: conta.id,
          nome_conta: conta.nome_conta,
          numero_conta: conta.numero_conta,
          banco: conta.bancos?.nome || "--",
          secretaria: nomeSecretaria,
          secretaria_id: conta.secretaria_id,
        })),
        comReservas: false,
      });
      setContas(contasComSaldo);

      const ids = (fornecedoresAtivos ?? []).map((item) => item.id);
      const { data: abertos, error: erroAbertos } = ids.length
        ? await supabase.from("valores_em_aberto").select("fornecedor_id, valor, valor_pago, situacao").in("fornecedor_id", ids).in("situacao", ["em_aberto", "programado", "parcialmente_pago"])
        : { data: [], error: null };
      if (erroAbertos) throw erroAbertos;
      const totais = (abertos ?? []).reduce((mapa, item) => {
        const chave = String(item.fornecedor_id);
        mapa[chave] = numero(mapa[chave]) + Math.max(0, numero(item.valor) - numero(item.valor_pago));
        return mapa;
      }, {});
      setFornecedores((fornecedoresAtivos ?? []).map((fornecedor) => ({
        ...fornecedor,
        valor_em_aberto: numero(totais[String(fornecedor.id)]),
      })).sort((a, b) => Number(b.valor_em_aberto > 0) - Number(a.valor_em_aberto > 0) || a.razao_social.localeCompare(b.razao_social, "pt-BR")));
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível carregar contas e fornecedores."));
    }
  }

  async function carregarProgramacoes(preferidaId = "") {
    try {
      const { data: itens, error } = await supabase.from("programacoes_pagamento")
        .select("id, nome_programacao, status, fechado, created_at")
        .eq("secretaria_id", secretariaId)
        .eq("data_programacao", data)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setProgramacoes(itens ?? []);
      const alvo = preferidaId || programacaoId;
      setProgramacaoId((itens ?? []).some((item) => String(item.id) === String(alvo)) ? alvo : itens?.[0]?.id || "");
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível carregar as programações."));
    }
  }

  function limparEdicao() {
    setProgramacao(null);
    setContasSelecionadas(new Set());
    setPagamentos([]);
  }

  async function carregarProgramacao(id) {
    setErro("");
    try {
      const [{ data: programa, error: erroPrograma }, { data: vinculadas, error: erroContas }, { data: itens, error: erroPagamentos }] = await Promise.all([
        supabase.from("programacoes_pagamento").select("id, nome_programacao, data_programacao, status, fechado, responsavel_id, created_at, updated_at").eq("id", id).single(),
        supabase.from("programacao_contas").select("conta_id, saldo_considerado, ordem").eq("programacao_id", id).eq("ativa", true).order("ordem"),
        supabase.from("pagamentos").select("id, fornecedor_id, valor_a_pagar, nome_avulso, cadastrar_fornecedor_posteriormente, fornecedores(razao_social)").eq("programacao_id", id).is("excluido_em", null).order("created_at"),
      ]);
      if (erroPrograma) throw erroPrograma;
      if (erroContas) throw erroContas;
      if (erroPagamentos) throw erroPagamentos;
      const { data: responsavel } = programa?.responsavel_id
        ? await supabase.from("usuarios").select("nome_completo").eq("id", programa.responsavel_id).maybeSingle()
        : { data: null };
      setProgramacao({ ...programa, responsavel });
      setContasSelecionadas(new Set((vinculadas ?? []).map((item) => item.conta_id)));
      setPagamentos((itens ?? []).map((item) => ({ ...item, valor_a_pagar: numero(item.valor_a_pagar) })));
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível abrir a programação. Rode a migration informada no resumo se necessário."));
    }
  }

  async function criarProgramacao() {
    if (!secretariaId || !podeEditar) return;
    setSalvando(true);
    setErro("");
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user?.id) throw new Error("Usuário não autenticado.");
      const { data: criada, error } = await supabase.from("programacoes_pagamento").insert({
        secretaria_id: Number(secretariaId),
        data_programacao: hojeISO(),
        nome_programacao: nomeAutomatico(hojeISO()),
        responsavel_id: auth.user.id,
        status: "em_elaboracao",
        saldo_considerado: 0,
        total_programado: 0,
        restante: 0,
      }).select("id, data_programacao").single();
      if (error) throw error;
      setData(criada.data_programacao);
      setProgramacaoId(criada.id);
      setMensagem("Programação criada em elaboração.");
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível criar a programação."));
    } finally {
      setSalvando(false);
    }
  }

  function alternarConta(contaId) {
    if (!programacao || !podeEditarProgramacao) return;
    setContasSelecionadas((atual) => alternarSelecao(atual, contaId));
  }

  function selecionarTodas() {
    if (!programacao || !podeEditarProgramacao) return;
    const idsVisiveis = contasFiltradas.map((conta) => conta.id);
    setContasSelecionadas((atual) => selecionarTodosVisiveis(atual, idsVisiveis));
  }

  function alternarFornecedor(fornecedor) {
    if (!programacao || !podeEditar) return;
    const existente = pagamentos.find((item) => String(item.fornecedor_id) === String(fornecedor.id));
    if (existente) {
      setPagamentos((itens) => itens.filter((item) => item !== existente));
      return;
    }
    setPagamentos((itens) => [...itens, {
      id: null,
      fornecedor_id: fornecedor.id,
      fornecedores: { razao_social: fornecedor.razao_social },
      valor_a_pagar: numero(fornecedor.valor_em_aberto),
      nome_avulso: null,
      cadastrar_fornecedor_posteriormente: false,
    }]);
  }

  function editarValor(chave, valor) {
    setPagamentos((itens) => definirValorProgramado(itens, chave, valor));
  }

  function adicionarAvulso() {
    if (!avulso.nome.trim() || numero(avulso.valor) <= 0) {
      setErro("Informe o nome e um valor maior que zero para o fornecedor avulso.");
      return;
    }
    setPagamentos((itens) => [...itens, {
      id: null,
      fornecedor_id: null,
      fornecedores: null,
      nome_avulso: avulso.nome.trim(),
      valor_a_pagar: numero(avulso.valor),
      cadastrar_fornecedor_posteriormente: avulso.cadastrarDepois,
    }]);
    setAvulso({ nome: "", valor: 0, cadastrarDepois: false });
    setMostrarAvulso(false);
    setErro("");
  }

  async function salvarProgramacao() {
    if (!programacao || !podeEditarProgramacao) return false;
    setSalvando(true);
    setErro("");
    setMensagem("");
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user?.id) throw new Error("Usuário não autenticado.");
      const selecionadas = contas.filter((conta) => contasSelecionadas.has(conta.id));
      const payloadContas = selecionadas.map((conta, indice) => ({
        conta_id: conta.id,
        saldo_considerado: numero(conta.saldo),
        ordem: indice + 1,
      }));
      const payloadPagamentos = pagamentos.map((item) => ({
        id: item.id,
        fornecedor_id: item.fornecedor_id,
        nome_avulso: item.nome_avulso,
        valor_a_pagar: numero(item.valor_a_pagar),
        cadastrar_fornecedor_posteriormente: Boolean(item.cadastrar_fornecedor_posteriormente),
      }));
      const { error } = await supabase.rpc("salvar_planejamento_programacao", {
        p_programacao_id: Number(programacao.id),
        p_contas: payloadContas,
        p_pagamentos: payloadPagamentos,
        p_saldo_considerado: totalDisponivel,
        p_total_programado: totalProgramado,
        p_restante: restante,
      });
      if (error) throw error;
      setMensagem("Programação salva com contas, fornecedores e valores preservados.");
      await carregarProgramacao(programacao.id);
      await carregarProgramacoes(programacao.id);
      return true;
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível salvar a programação."));
    } finally {
      setSalvando(false);
    }
    return false;
  }

  async function marcarEmAnalise() {
    if (!programacao || !podeEditarProgramacao) return;
    const salvo = await salvarProgramacao();
    if (!salvo) return;
    const { error } = await supabase.rpc("marcar_programacao_em_analise", { p_programacao_id: Number(programacao.id) });
    if (error) return setErro(mensagemAmigavel(error, "Não foi possível marcar como em análise."));
    setProgramacao((atual) => ({ ...atual, status: "em_analise" }));
    setMensagem("Programação marcada como em análise. Nenhum saldo foi movimentado.");
    await carregarProgramacoes(programacao.id);
  }

  function dadosDocumento() {
    return {
      titulo: "PROGRAMAÇÃO DIÁRIA DE PAGAMENTOS",
      data: dataBR(programacao.data_programacao),
      nome: programacao.nome_programacao,
      responsavel: programacao.responsavel?.nome_completo || usuario?.nome || usuario?.email || "--",
      contas: contasSelecionadasComSaldo.map((conta) => ({ banco: conta.banco, conta: conta.numero_conta, saldo: conta.saldo, nome: conta.nome_conta })),
      pagamentos: pagamentos.map((item) => ({ fornecedor: nomePagamento(item), valor: numero(item.valor_a_pagar) })),
      totalContas: totalDisponivel,
      totalProgramado,
      restante,
    };
  }

  async function registrarImpressao() {
    if (!programacao) return;
    await supabase.from("programacoes_pagamento").update({ ultima_impressao_em: new Date().toISOString() }).eq("id", programacao.id);
  }

  async function imprimir() {
    await registrarImpressao();
    imprimirProgramacao(dadosDocumento());
  }

  async function gerarPdf() {
    await registrarImpressao();
    gerarPdfProgramacao(dadosDocumento());
  }

  const contasFiltradas = contas.filter((conta) => textoConta(conta).includes(buscaConta.trim().toLocaleLowerCase("pt-BR")));
  const contasSelecionadasComSaldo = contas.filter((conta) => contasSelecionadas.has(conta.id));
  const totalDisponivel = somarContasSelecionadas(contas, contasSelecionadas);
  const totalProgramado = somarPagamentos(pagamentos);
  const restante = calcularRestante(totalDisponivel, totalProgramado);
  const idsSelecionados = new Set(pagamentos.filter((item) => item.fornecedor_id).map((item) => String(item.fornecedor_id)));
  const fornecedoresFiltrados = fornecedores.filter((item) => item.razao_social.toLocaleLowerCase("pt-BR").includes(buscaFornecedor.trim().toLocaleLowerCase("pt-BR")));
  const todasVisiveisMarcadas = contasFiltradas.length > 0 && contasFiltradas.every((conta) => contasSelecionadas.has(conta.id));

  return (
    <Layout titulo="Pagamentos Diários" subtitulo="Planejamento diário para análise da gestão">
      <div className="mx-auto max-w-[1500px] px-4 pb-16 sm:px-6">
        <div className="sticky top-0 z-30 -mx-4 mb-5 border-b border-[#17352F]/10 bg-[#F5F3EC]/95 px-4 py-3 shadow-[0_10px_28px_rgba(23,53,47,0.08)] backdrop-blur sm:-mx-6 sm:px-6">
          <div className="mx-auto grid max-w-[1500px] gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-white px-4 py-3"><span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#17352F]/55">Saldo da programação</span><strong className="mt-1 block font-serif text-xl tabular-nums text-[#17352F]">{formatBRL(totalDisponivel)}</strong></div>
            <div className="rounded-xl bg-white px-4 py-3"><span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#17352F]/55">Total programado</span><strong className="mt-1 block font-serif text-xl tabular-nums text-[#17352F]">{formatBRL(totalProgramado)}</strong></div>
            <div className={`rounded-xl px-4 py-3 ${restante < 0 ? "bg-[#FBE9DF] text-[#8A321C]" : "bg-[#E5EFEA] text-[#17352F]"}`}><span className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-65">Restante</span><strong className="mt-1 block font-serif text-xl tabular-nums">{formatBRL(restante)}</strong></div>
          </div>
          {restante < 0 && <p className="mx-auto mt-2 max-w-[1500px] rounded-lg bg-[#8A321C] px-3 py-2 text-center text-xs font-semibold text-white"><AlertTriangle size={14} className="mr-1 inline"/> PROGRAMAÇÃO ACIMA DO SALDO DISPONÍVEL — diferença de {formatBRL(Math.abs(restante))}</p>}
        </div>

        <div className="mb-5 grid gap-3 rounded-2xl border border-[#17352F]/10 bg-white p-4 shadow-sm lg:grid-cols-[1fr_13rem_auto] lg:items-end">
          <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[#17352F]/60">Secretaria<select value={secretariaId} onChange={(evento) => setSecretariaId(evento.target.value)} className="mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal">{secretarias.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
          <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[#17352F]/60">Data<input type="date" value={data} onChange={(evento) => setData(evento.target.value)} className="mt-1 block w-full rounded-lg border border-black/10 px-3 py-2 text-sm font-normal"/></label>
          <button onClick={criarProgramacao} disabled={!podeEditar || salvando} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#17352F] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Plus size={16}/> Nova programação</button>
        </div>

        {(erro || mensagem) && <div className={`mb-4 rounded-xl px-4 py-3 text-sm ${erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{erro || mensagem}<button onClick={() => { setErro(""); setMensagem(""); }} className="float-right"><X size={16}/></button></div>}

        {carregando ? <p className="py-16 text-center text-sm text-[#17352F]/55">Carregando...</p> : <>
          {programacoes.length > 0 && <div className="mb-5 flex gap-2 overflow-x-auto pb-1">{programacoes.map((item) => <button key={item.id} onClick={() => setProgramacaoId(item.id)} className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold ${String(programacaoId) === String(item.id) ? "border-[#17352F] bg-[#17352F] text-white" : "border-black/10 bg-white text-[#17352F]"}`}>{item.nome_programacao} · {statusLabel(item.status, item.fechado)}</button>)}</div>}

          {!programacao ? <div className="rounded-2xl border border-dashed border-[#17352F]/20 bg-white/60 px-6 py-20 text-center"><h2 className="font-serif text-2xl text-[#17352F]">Comece uma programação diária</h2><p className="mx-auto mt-2 max-w-xl text-sm text-[#17352F]/60">A seleção de contas apenas calcula o valor disponível para planejamento. Nenhuma conta é debitada, reservada ou bloqueada.</p></div> : <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#17352F] px-5 py-4 text-white">
              <div><p className="text-xs uppercase tracking-[0.16em] text-white/60">{statusLabel(programacao.status, programacao.fechado)}</p><h1 className="font-serif text-xl sm:text-2xl">{programacao.nome_programacao}</h1><p className="mt-1 text-xs text-white/60">ID {programacao.id} · criada em {new Date(programacao.created_at).toLocaleString("pt-BR")}</p></div>
              <div className="flex flex-wrap gap-2"><button onClick={salvarProgramacao} disabled={salvando || !podeEditarProgramacao} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#17352F] disabled:opacity-50">{salvando ? "Salvando..." : "Salvar programação"}</button><button onClick={imprimir} className="inline-flex items-center gap-2 rounded-lg border border-white/25 px-4 py-2 text-sm"><Printer size={15}/> Imprimir para análise</button><button onClick={gerarPdf} className="inline-flex items-center gap-2 rounded-lg border border-white/25 px-4 py-2 text-sm"><FileDown size={15}/> PDF</button>{programacao.status !== "em_analise" && !programacao.fechado && <button onClick={marcarEmAnalise} disabled={!podeEditarProgramacao} className="inline-flex items-center gap-2 rounded-lg bg-[#B98C55] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Check size={15}/> Marcar em análise</button>}</div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
              <section className="overflow-hidden rounded-2xl border border-[#17352F]/10 bg-white shadow-sm">
                <div className="border-b border-black/5 p-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#B06A3C]">1. Contas de trabalho</p><h2 className="font-serif text-xl text-[#17352F]">Selecionar contas</h2><p className="mt-1 text-xs text-[#17352F]/55">Selecionar conta não movimenta saldo.</p><div className="relative mt-3"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#17352F]/40"/><input value={buscaConta} onChange={(evento) => setBuscaConta(evento.target.value)} placeholder="Buscar banco, conta ou nome" className="w-full rounded-lg border border-black/10 py-2 pl-9 pr-3 text-sm"/></div></div>
                <label className="grid cursor-pointer grid-cols-[2rem_1fr] border-b border-black/5 bg-[#F2F0E8] px-4 py-3 text-sm font-semibold text-[#17352F]"><input type="checkbox" checked={todasVisiveisMarcadas} onChange={selecionarTodas} className="h-4 w-4 accent-[#17352F]"/> Selecionar todas</label>
                <div className="max-h-[430px] overflow-y-auto"><div className="hidden grid-cols-[2rem_1.1fr_1fr_1fr_1.2fr] gap-3 border-b border-black/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#17352F]/45 md:grid"><span></span><span>Banco</span><span>Nº da conta</span><span>Saldo</span><span>Nome da conta</span></div>{contasFiltradas.map((conta) => <label key={conta.id} className={`grid cursor-pointer gap-2 border-b border-black/5 px-4 py-3 text-sm last:border-0 md:grid-cols-[2rem_1.1fr_1fr_1fr_1.2fr] md:gap-3 ${contasSelecionadas.has(conta.id) ? "bg-[#E8F0EC]" : "hover:bg-[#FAF9F5]"}`}><input type="checkbox" checked={contasSelecionadas.has(conta.id)} onChange={() => alternarConta(conta.id)} className="h-4 w-4 accent-[#17352F]"/><span>{conta.banco}</span><span>{conta.numero_conta || "--"}</span><strong className="tabular-nums">{formatBRL(conta.saldo)}</strong><span>{conta.nome_conta || "--"}</span></label>)}</div>
                <div className="bg-[#17352F] px-4 py-3 text-sm font-semibold text-white">{contasSelecionadas.size} {contasSelecionadas.size === 1 ? "CONTA SELECIONADA" : "CONTAS SELECIONADAS"} — SALDO TOTAL DA PROGRAMAÇÃO: {formatBRL(totalDisponivel)}</div>
              </section>

              <section className="overflow-hidden rounded-2xl border border-[#17352F]/10 bg-white shadow-sm">
                <div className="border-b border-black/5 p-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#B06A3C]">2. Proposta</p><h2 className="font-serif text-xl text-[#17352F]">Fornecedores em aberto</h2><div className="relative mt-3"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#17352F]/40"/><input value={buscaFornecedor} onChange={(evento) => setBuscaFornecedor(evento.target.value)} placeholder="Buscar fornecedor" className="w-full rounded-lg border border-black/10 py-2 pl-9 pr-3 text-sm"/></div></div>
                <div className="max-h-[330px] overflow-y-auto">{fornecedoresFiltrados.map((fornecedor) => { const marcado = idsSelecionados.has(String(fornecedor.id)); return <label key={fornecedor.id} className={`grid cursor-pointer grid-cols-[2rem_1fr_auto] items-center gap-3 border-b border-black/5 px-4 py-3 text-sm last:border-0 ${marcado ? "bg-[#E8F0EC]" : "hover:bg-[#FAF9F5]"}`}><input type="checkbox" checked={marcado} onChange={() => alternarFornecedor(fornecedor)} className="h-4 w-4 accent-[#17352F]"/><span className="font-medium text-[#17352F]">{fornecedor.razao_social}</span><span className={fornecedor.valor_em_aberto > 0 ? "font-semibold tabular-nums text-[#B05D31]" : "text-[#17352F]/40"}>{formatBRL(fornecedor.valor_em_aberto)} em aberto</span></label>; })}</div>
                <div className="border-t border-black/5 p-4"><button onClick={() => setMostrarAvulso((valor) => !valor)} className="inline-flex items-center gap-2 text-sm font-semibold text-[#A5542F]"><Plus size={15}/> Adicionar fornecedor avulso</button>{mostrarAvulso && <div className="mt-3 grid gap-3 rounded-xl bg-[#FBF3EA] p-3 sm:grid-cols-[1fr_10rem_auto]"><input value={avulso.nome} onChange={(evento) => setAvulso({ ...avulso, nome: evento.target.value })} placeholder="Nome" className="rounded-lg border border-black/10 px-3 py-2 text-sm"/><CampoMoeda valor={avulso.valor} onValorChange={(valor) => setAvulso({ ...avulso, valor })} className="rounded-lg border border-black/10 px-3 py-2 text-right text-sm"/><button onClick={adicionarAvulso} className="rounded-lg bg-[#A5542F] px-3 py-2 text-sm font-semibold text-white">Adicionar</button><label className="flex items-center gap-2 text-xs text-[#17352F]/65 sm:col-span-3"><input type="checkbox" checked={avulso.cadastrarDepois} onChange={(evento) => setAvulso({ ...avulso, cadastrarDepois: evento.target.checked })}/> Cadastrar posteriormente como fornecedor</label></div>}</div>
              </section>
            </div>

            <section className="mt-5 overflow-hidden rounded-2xl border border-[#17352F]/10 bg-white shadow-sm">
              <div className="border-b border-black/5 p-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#B06A3C]">3. Valores</p><h2 className="font-serif text-xl text-[#17352F]">Pagamentos propostos</h2><p className="mt-1 text-xs text-[#17352F]/55">O valor é totalmente editável e pode ser menor que o total em aberto.</p></div>
              {pagamentos.length === 0 ? <p className="px-4 py-10 text-center text-sm text-[#17352F]/45">Selecione fornecedores ou adicione um avulso.</p> : <div>{pagamentos.map((pagamento, indice) => <div key={pagamento.id || `${pagamento.nome_avulso || pagamento.fornecedor_id}-${indice}`} className="grid gap-3 border-b border-black/5 px-4 py-3 last:border-0 sm:grid-cols-[1fr_13rem_auto] sm:items-center"><div><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#17352F]/45">Fornecedor</span><strong className="block text-sm text-[#17352F]">{nomePagamento(pagamento)}</strong>{pagamento.cadastrar_fornecedor_posteriormente && <small className="text-[#A5542F]">Cadastrar posteriormente</small>}</div><label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#17352F]/45">Valor a programar<CampoMoeda valor={pagamento.valor_a_pagar} onValorChange={(valor) => editarValor(pagamento, valor)} className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-right text-sm font-semibold normal-case tracking-normal text-[#17352F]"/></label><button onClick={() => setPagamentos((itens) => itens.filter((item) => item !== pagamento))} className="rounded-lg p-2 text-red-600 hover:bg-red-50" aria-label={`Retirar ${nomePagamento(pagamento)} da programação`}><Trash2 size={17}/></button></div>)}</div>}
            </section>
          </>}
        </>}
      </div>
    </Layout>
  );
}
