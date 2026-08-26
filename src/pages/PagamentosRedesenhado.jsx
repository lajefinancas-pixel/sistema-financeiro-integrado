import React from "react";
import { AlertTriangle, ArrowRightLeft, Check, ChevronRight, FileText, Lock, Plus, Printer, Search, Trash2, Unlock, X } from "lucide-react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "../lib/supabaseClient";
import Layout from "../components/Layout";
import PainelFiltros from "../components/comuns/PainelFiltros";
import CampoMoeda from "../components/CampoMoeda";
import ModalBaixaPagamento from "../components/pagamentos/ModalBaixaPagamento";
import { formatBRL, paraNumeroMoeda } from "../lib/moeda";
import { mensagemAmigavel } from "../lib/erros";
import { carregarSaldosDasContas } from "../lib/saldosContasDados";
import { totalizarSaldos } from "../lib/saldosContas";
import { confirmarTransferencias, estornarTransferencia } from "../lib/transferenciasContas";
import { filtroVigentes, excluirRegistro } from "../lib/exclusaoRegistros";
import { usePermissaoModulo } from "../lib/permissoes";
import { usePermissoesEspeciais } from "../lib/permissoesEspeciais";
import { resumoBaixas } from "../lib/regrasBaixas";

const hojeISO = () => new Date().toISOString().slice(0, 10);
const numero = (valor) => Math.round(paraNumeroMoeda(valor) * 100) / 100;
const somar = (valores) => valores.reduce((total, valor) => total + numero(valor), 0);
const textoConta = (conta) => `${conta.nome_conta ?? ""} ${conta.banco ?? ""} ${conta.numero_conta ?? ""}`.toLocaleLowerCase("pt-BR");

function nomePagamento(pagamento) {
  return pagamento.fornecedores?.razao_social || pagamento.nome_avulso || "Fornecedor não cadastrado";
}

function PainelConta({ conta, marcada, bloqueada, onChange }) {
  return (
    <label className={`grid cursor-pointer grid-cols-[auto_1fr_auto] gap-3 border-b border-black/5 px-4 py-3 last:border-0 ${marcada ? "bg-[#EDF4F1]" : "hover:bg-[#F8FAF9]"} ${bloqueada ? "cursor-not-allowed opacity-60" : ""}`}>
      <input type="checkbox" checked={marcada} disabled={bloqueada} onChange={onChange} className="mt-1 h-4 w-4 accent-[#175C4C]" />
      <span className="min-w-0">
        <strong className="block truncate text-sm text-[#17352F]">{conta.nome_conta || "Conta sem nome"}</strong>
        <span className="mt-1 block text-xs text-[#17352F]/55">{conta.banco || "Banco não informado"} · {conta.numero_conta || "Sem número"} · {conta.secretaria}</span>
      </span>
      <span className="text-right">
        <small className="block uppercase tracking-[0.12em] text-[#17352F]/40">Saldo atual</small>
        <strong className="tabular-nums text-[#17352F]">{formatBRL(conta.saldo)}</strong>
      </span>
    </label>
  );
}

export default function PagamentosRedesenhado() {
  const { permissao } = usePermissaoModulo("pagamentos");
  const { valores: permissoesEspeciais } = usePermissoesEspeciais();
  const podeEditar = permissao?.pode_editar !== false;
  const podeExcluir = permissao?.pode_excluir === true;
  const [carregando, setCarregando] = React.useState(true);
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState("");
  const [secretarias, setSecretarias] = React.useState([]);
  const [secretariaId, setSecretariaId] = React.useState("");
  const [data, setData] = React.useState(hojeISO());
  const [programacoes, setProgramacoes] = React.useState([]);
  const [programacaoId, setProgramacaoId] = React.useState("");
  const [nomeProgramacao, setNomeProgramacao] = React.useState("");
  const [contas, setContas] = React.useState([]);
  const [contasDestinoTransferencia, setContasDestinoTransferencia] = React.useState([]);
  const [contasSelecionadas, setContasSelecionadas] = React.useState(new Set());
  const [buscaConta, setBuscaConta] = React.useState("");
  const [filtroBanco, setFiltroBanco] = React.useState("");
  const [fornecedores, setFornecedores] = React.useState([]);
  const [buscaFornecedor, setBuscaFornecedor] = React.useState("");
  const [pagamentos, setPagamentos] = React.useState([]);
  const [baixasPorPagamento, setBaixasPorPagamento] = React.useState({});
  const [baixaPendente, setBaixaPendente] = React.useState(null);
  const [avulso, setAvulso] = React.useState({ nome: "", valor: 0 });
  const [mostrarAvulso, setMostrarAvulso] = React.useState(false);
  const [destinoConcentracao, setDestinoConcentracao] = React.useState("");
  const [valoresTransferencia, setValoresTransferencia] = React.useState({});
  const [transferencias, setTransferencias] = React.useState([]);
  const [fechado, setFechado] = React.useState(false);
  const timers = React.useRef({});
  const transferindo = React.useRef(false);
  const efetivando = React.useRef(false);

  React.useEffect(() => {
    carregarSecretarias();
    return () => Object.values(timers.current).forEach(clearTimeout);
  }, []);

  React.useEffect(() => {
    if (!secretariaId) return;
    carregarBase();
    carregarProgramacoes();
  }, [secretariaId, data]);

  React.useEffect(() => {
    if (programacaoId) carregarProgramacao();
    else limparProgramacao();
  }, [programacaoId]);

  async function carregarSecretarias() {
    try {
      const { data: itens, error } = await supabase.from("secretarias").select("id, nome").eq("ativo", true).order("nome");
      if (error) throw error;
      setSecretarias(itens ?? []);
      setSecretariaId((atual) => atual || itens?.[0]?.id || "");
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível carregar as secretarias."));
    } finally {
      setCarregando(false);
    }
  }

  async function carregarBase() {
    try {
      const { data: contasBrutas, error: erroContas } = await supabase
        .from("contas_bancarias")
        .select("id, nome_conta, numero_conta, secretaria_id, bancos(nome)")
        .eq("secretaria_id", secretariaId)
        .eq("ativo", true);
      if (erroContas) throw erroContas;
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

      const secretariaFinanceira = nomeSecretaria.toLocaleLowerCase("pt-BR").includes("finan");
      if (secretariaFinanceira) {
        const destinosPermitidos = secretarias.filter((item) => /saúde|saude|educa|social/i.test(item.nome)).map((item) => item.id);
        const { data: destinos, error: erroDestinos } = destinosPermitidos.length
          ? await supabase.from("contas_bancarias").select("id, nome_conta, numero_conta, secretaria_id, bancos(nome), secretarias(nome)").in("secretaria_id", destinosPermitidos).eq("ativo", true).order("nome_conta")
          : { data: [], error: null };
        if (erroDestinos) throw erroDestinos;
        setContasDestinoTransferencia((destinos ?? []).map((conta) => ({ id: conta.id, nome_conta: conta.nome_conta, numero_conta: conta.numero_conta, banco: conta.bancos?.nome || "--", secretaria: conta.secretarias?.nome || "--", externa: true })));
      } else {
        setContasDestinoTransferencia([]);
      }

      const { data: fornecedoresAtivos, error: erroFornecedores } = await supabase
        .from("fornecedores")
        .select("id, razao_social")
        .eq("secretaria_id", secretariaId)
        .eq("ativo", true)
        .order("razao_social");
      if (erroFornecedores) throw erroFornecedores;
      const ids = (fornecedoresAtivos ?? []).map((item) => item.id);
      const { data: abertos, error: erroAbertos } = ids.length
        ? await supabase.from("valores_em_aberto").select("id, fornecedor_id, numero_nota_fiscal, valor, valor_pago, situacao").in("fornecedor_id", ids).in("situacao", ["em_aberto", "programado", "parcialmente_pago"])
        : { data: [], error: null };
      if (erroAbertos) throw erroAbertos;
      setFornecedores((fornecedoresAtivos ?? []).flatMap((fornecedor) =>
        (abertos ?? []).filter((item) => String(item.fornecedor_id) === String(fornecedor.id)).map((item) => ({
          ...fornecedor,
          valor_em_aberto_id: item.id,
          numero_nota_fiscal: item.numero_nota_fiscal,
          valor_em_aberto: Math.max(0, numero(item.valor) - numero(item.valor_pago)),
        }))
      ));
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível carregar contas e fornecedores."));
    }
  }

  async function carregarProgramacoes() {
    try {
      const { data: itens, error } = await supabase.from("programacoes_pagamento")
        .select("id, nome_programacao, fechado, created_at")
        .eq("secretaria_id", secretariaId).eq("data_programacao", data).order("created_at");
      if (error) throw error;
      setProgramacoes(itens ?? []);
      setProgramacaoId((atual) => itens?.some((item) => String(item.id) === String(atual)) ? atual : itens?.[0]?.id || "");
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível carregar as programações."));
    }
  }

  function limparProgramacao() {
    setContasSelecionadas(new Set());
    setPagamentos([]);
    setTransferencias([]);
    setDestinoConcentracao("");
    setValoresTransferencia({});
    setFechado(false);
  }

  async function carregarProgramacao() {
    setErro("");
    try {
      const vigentes = await filtroVigentes("pagamentos");
      const [{ data: programa, error: erroPrograma }, { data: vinculadas, error: erroVinculadas }, resultadoPagamentos, { data: transferidas, error: erroTransferidas }] = await Promise.all([
        supabase.from("programacoes_pagamento").select("id, fechado").eq("id", programacaoId).single(),
        supabase.from("programacao_contas").select("conta_id, ordem").eq("programacao_id", programacaoId).order("ordem"),
        vigentes(supabase.from("pagamentos").select("id, fornecedor_id, valor_em_aberto_id, valor_a_pagar, situacao, nome_avulso, descricao, conta_origem_id, fornecedores(razao_social), valores_em_aberto(numero_nota_fiscal, valor, valor_pago)").eq("programacao_id", programacaoId).order("created_at")),
        supabase.from("transferencias_contas").select("id, conta_origem_id, conta_destino_id, valor, criada_em, estornada_em, transferencia_original_id").eq("programacao_id", programacaoId).order("criada_em", { ascending: false }),
      ]);
      if (erroPrograma) throw erroPrograma;
      if (erroVinculadas) throw erroVinculadas;
      if (resultadoPagamentos.error) throw resultadoPagamentos.error;
      if (erroTransferidas) throw erroTransferidas;
      const itens = resultadoPagamentos.data ?? [];
      setFechado(programa?.fechado === true);
      setContasSelecionadas(new Set((vinculadas ?? []).map((item) => item.conta_id)));
      setPagamentos(itens);
      setTransferencias(transferidas ?? []);
      setDestinoConcentracao((transferidas ?? []).find((item) => !item.transferencia_original_id)?.conta_destino_id || "");
      const ids = itens.map((item) => item.id);
      if (ids.length) {
        const { data: baixas } = await supabase.from("pagamentos_baixas").select("*").in("pagamento_id", ids).order("data_pagamento", { ascending: false });
        setBaixasPorPagamento((baixas ?? []).reduce((mapa, baixa) => ({ ...mapa, [String(baixa.pagamento_id)]: [...(mapa[String(baixa.pagamento_id)] ?? []), baixa] }), {}));
      } else setBaixasPorPagamento({});
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível carregar a programação. Rode a migration informada no resumo se o banco ainda não recebeu o novo fluxo."));
    }
  }

  async function criarProgramacao() {
    if (!nomeProgramacao.trim()) return setErro("Informe um nome para a programação.");
    setSalvando(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const { data: criada, error } = await supabase.from("programacoes_pagamento").insert({
        secretaria_id: secretariaId,
        data_programacao: data,
        nome_programacao: nomeProgramacao.trim(),
        responsavel_id: auth.user.id,
      }).select("id").single();
      if (error) throw error;
      setNomeProgramacao("");
      await carregarProgramacoes();
      setProgramacaoId(criada.id);
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível criar a programação."));
    } finally {
      setSalvando(false);
    }
  }

  async function alternarConta(contaId) {
    if (!programacaoId || fechado) return;
    const marcada = contasSelecionadas.has(contaId);
    if (marcada && pagamentos.some((item) => String(item.conta_origem_id) === String(contaId) && item.situacao !== "pago")) {
      return setErro("Esta conta está indicada em um pagamento. Altere a conta do pagamento antes de removê-la.");
    }
    setErro("");
    if (marcada) {
      const { error } = await supabase.from("programacao_contas").delete().eq("programacao_id", programacaoId).eq("conta_id", contaId);
      if (error) return setErro(mensagemAmigavel(error, "Não foi possível remover a conta."));
    } else {
      const { error } = await supabase.from("programacao_contas").insert({ programacao_id: programacaoId, conta_id: contaId, ordem: contasSelecionadas.size + 1, valor_rateado: 0, valor_transferir: 0 });
      if (error) return setErro(mensagemAmigavel(error, "Não foi possível selecionar a conta."));
    }
    setContasSelecionadas((atual) => {
      const proximo = new Set(atual);
      marcada ? proximo.delete(contaId) : proximo.add(contaId);
      return proximo;
    });
  }

  async function selecionarTodas() {
    const faltantes = contasFiltradas.filter((conta) => !contasSelecionadas.has(conta.id));
    if (!faltantes.length) return;
    const { error } = await supabase.from("programacao_contas").insert(faltantes.map((conta, indice) => ({
      programacao_id: programacaoId,
      conta_id: conta.id,
      ordem: contasSelecionadas.size + indice + 1,
      valor_rateado: 0,
      valor_transferir: 0,
    })));
    if (error) return setErro(mensagemAmigavel(error, "Não foi possível selecionar todas as contas."));
    setContasSelecionadas((atual) => new Set([...atual, ...faltantes.map((conta) => conta.id)]));
  }

  async function adicionarFornecedor(item) {
    if (fechado) return;
    const jaExiste = pagamentos.some((pagamento) => String(pagamento.valor_em_aberto_id) === String(item.valor_em_aberto_id));
    if (jaExiste) return setErro("Este valor em aberto já está na relação.");
    setSalvando(true);
    try {
      const { error } = await supabase.from("pagamentos").insert({
        programacao_id: programacaoId,
        fornecedor_id: item.id,
        valor_em_aberto_id: item.valor_em_aberto_id,
        valor_a_pagar: item.valor_em_aberto,
        situacao: "programado",
      });
      if (error) throw error;
      await carregarProgramacao();
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível adicionar o fornecedor."));
    } finally {
      setSalvando(false);
    }
  }

  async function adicionarAvulso() {
    if (!avulso.nome.trim() || numero(avulso.valor) <= 0) return setErro("Informe nome e valor do fornecedor não cadastrado.");
    setSalvando(true);
    try {
      const { error } = await supabase.from("pagamentos").insert({
        programacao_id: programacaoId,
        nome_avulso: avulso.nome.trim(),
        descricao: "Fornecedor não cadastrado",
        valor_a_pagar: numero(avulso.valor),
        situacao: "programado",
      });
      if (error) throw error;
      setAvulso({ nome: "", valor: 0 });
      setMostrarAvulso(false);
      await carregarProgramacao();
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível adicionar o fornecedor não cadastrado."));
    } finally {
      setSalvando(false);
    }
  }

  function editarValor(pagamentoId, valor) {
    setPagamentos((atuais) => atuais.map((item) => String(item.id) === String(pagamentoId) ? { ...item, valor_a_pagar: valor } : item));
    clearTimeout(timers.current[pagamentoId]);
    timers.current[pagamentoId] = setTimeout(async () => {
      const { error } = await supabase.from("pagamentos").update({ valor_a_pagar: numero(valor) }).eq("id", pagamentoId);
      if (error) setErro(mensagemAmigavel(error, "Não foi possível salvar o valor a pagar."));
    }, 450);
  }

  async function definirContaPagamento(pagamentoId, contaId) {
    const { error } = await supabase.rpc("definir_conta_origem_pagamento", { p_pagamento_id: String(pagamentoId), p_conta_id: Number(contaId) });
    if (error) return setErro(mensagemAmigavel(error, "Não foi possível definir a conta de origem."));
    setPagamentos((atuais) => atuais.map((item) => String(item.id) === String(pagamentoId) ? { ...item, conta_origem_id: Number(contaId) } : item));
  }

  async function removerPagamento(pagamento) {
    if (!podeExcluir || pagamento.situacao === "pago") return;
    if (!window.confirm(`Remover ${nomePagamento(pagamento)} da relação?`)) return;
    try {
      await excluirRegistro({ tabela: "pagamentos", id: pagamento.id });
      await carregarProgramacao();
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível remover o pagamento."));
    }
  }

  async function confirmarConcentracao() {
    if (transferindo.current || !destinoConcentracao) return;
    const itens = contasSelecionadasComSaldo
      .filter((conta) => String(conta.id) !== String(destinoConcentracao) && numero(valoresTransferencia[conta.id]) > 0)
      .map((conta) => ({ sourceAccountId: conta.id, amount: numero(valoresTransferencia[conta.id]) }));
    if (!itens.length) return setErro("Informe ao menos um valor para concentrar.");
    const excedente = itens.find((item) => item.amount > numero(contas.find((conta) => String(conta.id) === String(item.sourceAccountId))?.saldo));
    if (excedente) return setErro("O valor de transferência não pode superar o saldo da conta de origem.");
    if (!window.confirm(`Confirmar a concentração de ${formatBRL(somar(itens.map((item) => item.amount)))}?`)) return;
    transferindo.current = true;
    setSalvando(true);
    try {
      await confirmarTransferencias({
        programId: programacaoId,
        destinationAccountId: destinoConcentracao,
        transfers: itens,
        idempotencyKey: crypto.randomUUID(),
        note: `Concentração opcional da programação de ${data}`,
      });
      setValoresTransferencia({});
      await carregarBase();
      await carregarProgramacao();
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível confirmar a concentração."));
    } finally {
      transferindo.current = false;
      setSalvando(false);
    }
  }

  async function estornar(item) {
    const motivo = window.prompt("Informe o motivo do estorno:");
    if (!motivo?.trim()) return;
    try {
      await estornarTransferencia(item.id, motivo.trim());
      await carregarBase();
      await carregarProgramacao();
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível estornar a transferência."));
    }
  }

  async function registrarImpressao() {
    await supabase.rpc("registrar_impressao_programacao", { p_programacao_id: programacaoId }).then(() => null);
  }

  async function imprimir() {
    await registrarImpressao();
    window.print();
  }

  async function gerarPdf() {
    await registrarImpressao();
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const secretaria = secretarias.find((item) => String(item.id) === String(secretariaId))?.nome || "Secretaria";
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("Relação para aprovação de pagamentos", 14, 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`${secretaria} · ${new Date(`${data}T00:00:00`).toLocaleDateString("pt-BR")}`, 14, 23);
    autoTable(doc, {
      startY: 29,
      head: [["Conta selecionada", "Banco", "Número", "Saldo"]],
      body: contasSelecionadasComSaldo.map((conta) => [conta.nome_conta, conta.banco, conta.numero_conta || "--", formatBRL(conta.saldo)]),
      foot: [["Somatório dos saldos", "", "", formatBRL(totalDisponivel)]],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [23, 92, 76] },
    });
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 8,
      head: [["Fornecedor", "Valor a pagar", "Anotações / alteração do chefe"]],
      body: pagamentos.map((pagamento) => [nomePagamento(pagamento), formatBRL(pagamento.valor_a_pagar), ""]),
      foot: [["Total a pagar", formatBRL(totalPagar), ""]],
      styles: { fontSize: 9, minCellHeight: 13 },
      headStyles: { fillColor: [23, 92, 76] },
      columnStyles: { 2: { cellWidth: 70 } },
    });
    doc.save(`relacao-pagamentos-${data}.pdf`);
  }

  async function alternarFechamento() {
    const pendentes = pagamentos.some((item) => item.situacao !== "pago");
    if (!fechado && pendentes) return setErro("A programação permanece editável até todos os pagamentos serem efetuados.");
    const { error } = await supabase.from("programacoes_pagamento").update({ fechado: !fechado }).eq("id", programacaoId);
    if (error) return setErro(mensagemAmigavel(error, "Não foi possível alterar o fechamento."));
    setFechado(!fechado);
    await carregarProgramacoes();
  }

  function abrirBaixa(pagamento) {
    if (efetivando.current) return;
    if (!pagamento.conta_origem_id) return setErro("Indique de qual conta este pagamento sai antes de efetivá-lo.");
    efetivando.current = true;
    setBaixaPendente(pagamento);
    setTimeout(() => { efetivando.current = false; }, 400);
  }

  const contasFiltradas = React.useMemo(() => contas.filter((conta) => {
    const termo = buscaConta.trim().toLocaleLowerCase("pt-BR");
    return (!termo || textoConta(conta).includes(termo)) && (!filtroBanco || conta.banco === filtroBanco);
  }), [contas, buscaConta, filtroBanco]);
  const contasSelecionadasComSaldo = React.useMemo(() => contas.filter((conta) => contasSelecionadas.has(conta.id)), [contas, contasSelecionadas]);
  const totalDisponivel = React.useMemo(() => totalizarSaldos(contasSelecionadasComSaldo).saldoReal, [contasSelecionadasComSaldo]);
  const totalPagar = React.useMemo(() => somar(pagamentos.map((item) => item.valor_a_pagar)), [pagamentos]);
  const diferenca = totalDisponivel - totalPagar;
  const bancos = [...new Set(contas.map((conta) => conta.banco).filter(Boolean))].sort();
  const fornecedoresFiltrados = fornecedores.filter((item) => `${item.razao_social} ${item.numero_nota_fiscal || ""}`.toLocaleLowerCase("pt-BR").includes(buscaFornecedor.trim().toLocaleLowerCase("pt-BR")));
  const secretariaAtual = secretarias.find((item) => String(item.id) === String(secretariaId))?.nome || "--";
  const destinosConcentracao = [...contasSelecionadasComSaldo, ...contasDestinoTransferencia];
  const chips = [{ chave: "secretaria", rotulo: `Secretaria: ${secretariaAtual}` }, { chave: "data", rotulo: `Data: ${new Date(`${data}T00:00:00`).toLocaleDateString("pt-BR")}` }];

  return (
    <Layout>
      <div className="min-h-screen bg-[#F3F1EA] px-4 py-6 text-[#17352F] sm:px-8 print:bg-white print:p-0">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-4 print:hidden">
          <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#A35B35]">Saldo primeiro</p><h1 className="mt-1 font-serif text-3xl font-semibold">Pagamentos Diários</h1><p className="mt-1 text-sm text-[#17352F]/60">Monte uma proposta, imprima para aprovação e só depois efetive cada pagamento.</p></div>
          <div className="flex gap-2"><button onClick={imprimir} disabled={!programacaoId} className="flex items-center gap-2 rounded-lg border border-[#17352F]/15 bg-white px-3 py-2 text-sm disabled:opacity-40"><Printer size={15}/> Imprimir</button><button onClick={gerarPdf} disabled={!programacaoId} className="flex items-center gap-2 rounded-lg bg-[#17352F] px-3 py-2 text-sm text-white disabled:opacity-40"><FileText size={15}/> PDF</button></div>
        </header>

        <PainelFiltros chips={chips} className="mb-5 print:hidden">
          <div className="grid gap-3 pt-3 sm:grid-cols-2">
            <label className="text-xs font-medium">Secretaria<select value={secretariaId} onChange={(evento) => { setSecretariaId(evento.target.value); setProgramacaoId(""); }} className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm">{secretarias.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
            <label className="text-xs font-medium">Data da programação<input type="date" value={data} onChange={(evento) => { setData(evento.target.value); setProgramacaoId(""); }} className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"/></label>
          </div>
        </PainelFiltros>

        {erro && <div className="mb-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 print:hidden"><AlertTriangle size={16} className="mt-0.5 shrink-0"/>{erro}<button onClick={() => setErro("")} className="ml-auto"><X size={15}/></button></div>}
        {carregando ? <p>Carregando...</p> : <>
          <section className="mb-5 rounded-2xl border border-black/5 bg-white p-4 shadow-sm print:hidden">
            <div className="flex flex-wrap items-center gap-2"><input value={nomeProgramacao} onChange={(evento) => setNomeProgramacao(evento.target.value)} placeholder="Nome da nova programação" className="min-w-56 flex-1 rounded-lg border border-black/10 px-3 py-2 text-sm"/><button onClick={criarProgramacao} disabled={salvando} className="rounded-lg bg-[#17352F] px-4 py-2 text-sm text-white"><Plus size={15} className="mr-1 inline"/> Nova programação</button></div>
            <div className="mt-3 flex flex-wrap gap-2">{programacoes.map((item) => <button key={item.id} onClick={() => setProgramacaoId(item.id)} className={`flex items-center gap-1 rounded-lg border px-3 py-2 text-xs ${String(programacaoId) === String(item.id) ? "border-[#17352F] bg-[#17352F] text-white" : "border-black/10"}`}>{String(programacaoId) === String(item.id) && <ChevronRight size={12}/>} {item.fechado && <Lock size={11}/>} {item.nome_programacao || "Sem nome"}</button>)}</div>
          </section>

          {programacaoId && <>
            <div className="sticky top-0 z-30 mb-5 grid gap-px overflow-hidden rounded-2xl border border-[#17352F]/15 bg-[#17352F]/10 shadow-lg sm:grid-cols-3 print:hidden">
              <div className="bg-[#17352F] px-4 py-3 text-white"><small className="uppercase tracking-[0.14em] opacity-65">Contas selecionadas</small><strong className="block text-xl">{contasSelecionadas.size}</strong></div>
              <div className="bg-[#17352F] px-4 py-3 text-white"><small className="uppercase tracking-[0.14em] opacity-65">Total disponível hoje</small><strong className="block text-xl tabular-nums">{formatBRL(totalDisponivel)}</strong></div>
              <div className={`px-4 py-3 ${diferenca < 0 ? "bg-[#FFF0E7] text-[#9B3E20]" : "bg-white"}`}><small className="uppercase tracking-[0.14em] opacity-60">Total a pagar · diferença</small><strong className="block text-xl tabular-nums">{formatBRL(totalPagar)} · {formatBRL(diferenca)}</strong></div>
            </div>

            <section className="mb-5 grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(22rem,.7fr)] print:hidden">
              <div className="rounded-2xl border border-black/5 bg-white shadow-sm print:shadow-none">
                <div className="border-b border-black/5 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#A35B35]">Etapa 2</p><h2 className="font-serif text-xl font-semibold">Contas de trabalho</h2><p className="text-xs text-[#17352F]/55">Selecionar conta não movimenta saldo.</p></div><button onClick={selecionarTodas} disabled={fechado} className="rounded-lg border border-black/10 px-3 py-2 text-xs">Selecionar todas</button></div><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_14rem]"><label className="relative"><Search size={14} className="absolute left-3 top-2.5 opacity-40"/><input value={buscaConta} onChange={(evento) => setBuscaConta(evento.target.value)} placeholder="Buscar conta, banco ou número" className="w-full rounded-lg border border-black/10 py-2 pl-9 pr-3 text-sm"/></label><select value={filtroBanco} onChange={(evento) => setFiltroBanco(evento.target.value)} className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"><option value="">Todos os bancos</option>{bancos.map((banco) => <option key={banco}>{banco}</option>)}</select></div></div>
                <div className="max-h-[30rem] overflow-y-auto">{contasFiltradas.map((conta) => <PainelConta key={conta.id} conta={conta} marcada={contasSelecionadas.has(conta.id)} bloqueada={fechado || !podeEditar} onChange={() => alternarConta(conta.id)}/>)}</div>
              </div>

              <div className="rounded-2xl border border-black/5 bg-[#FBFAF5] p-4 shadow-sm print:hidden"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#A35B35]">Etapa 3 · opcional</p><h2 className="font-serif text-xl font-semibold">Concentrar saldos</h2><p className="mt-1 text-xs text-[#17352F]/55">Transfira para uma conta marcada. Em Finanças, também aparecem contas de Saúde, Educação e Social para o repasse legítimo entre secretarias.</p><select value={destinoConcentracao} onChange={(evento) => setDestinoConcentracao(evento.target.value)} className="mt-3 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"><option value="">Conta concentradora ou destinatária...</option>{destinosConcentracao.map((conta) => <option key={`${conta.externa ? "externa" : "interna"}-${conta.id}`} value={conta.id}>{conta.nome_conta} · {conta.banco}{conta.externa ? ` · ${conta.secretaria}` : ""}</option>)}</select><div className="mt-3 space-y-2">{contasSelecionadasComSaldo.filter((conta) => String(conta.id) !== String(destinoConcentracao)).map((conta) => <label key={conta.id} className="grid grid-cols-[1fr_9rem] items-center gap-2 text-xs"><span>{conta.nome_conta}<strong className="block tabular-nums">{formatBRL(conta.saldo)}</strong></span><CampoMoeda valor={valoresTransferencia[conta.id] ?? 0} onValorChange={(valor) => setValoresTransferencia((atual) => ({ ...atual, [conta.id]: valor }))} className="rounded-lg border border-black/10 bg-white px-2 py-2 text-right"/></label>)}</div><button onClick={confirmarConcentracao} disabled={salvando || !destinoConcentracao || !permissoesEspeciais.executar_transferencia} className="mt-4 w-full rounded-lg bg-[#A35B35] px-3 py-2 text-sm text-white disabled:opacity-40"><ArrowRightLeft size={15} className="mr-1 inline"/> Confirmar transferência</button><p className="mt-2 text-[11px] text-[#17352F]/50">Somente a confirmação movimenta débito e crédito na mesma transação. Não é despesa.</p></div>
            </section>

            {transferencias.length > 0 && <section className="mb-5 rounded-2xl border border-black/5 bg-white p-4 print:hidden"><h2 className="font-serif text-lg font-semibold">Origens da concentração</h2><div className="mt-2 grid gap-2">{transferencias.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#F4F6F2] px-3 py-2 text-xs"><span><strong>{contas.find((conta) => String(conta.id) === String(item.conta_origem_id))?.nome_conta || "Conta de origem"}</strong> → {[...contas, ...contasDestinoTransferencia].find((conta) => String(conta.id) === String(item.conta_destino_id))?.nome_conta || "Conta concentradora"}</span><span className="flex items-center gap-2"><strong>{formatBRL(item.valor)}</strong>{!item.estornada_em && !item.transferencia_original_id && permissoesEspeciais.estornar_transferencia && <button onClick={() => estornar(item)} className="text-red-600">Estornar</button>}{(item.estornada_em || item.transferencia_original_id) && <em>Estornada</em>}</span></div>)}</div></section>}

            <section className="mb-5 grid gap-5 lg:grid-cols-[minmax(20rem,.7fr)_minmax(0,1.3fr)] print:hidden">
              <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm print:hidden"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#A35B35]">Etapa 4</p><h2 className="font-serif text-xl font-semibold">Fornecedores com valor em aberto</h2><label className="relative mt-3 block"><Search size={14} className="absolute left-3 top-2.5 opacity-40"/><input value={buscaFornecedor} onChange={(evento) => setBuscaFornecedor(evento.target.value)} placeholder="Buscar fornecedor ou nota" className="w-full rounded-lg border border-black/10 py-2 pl-9 pr-3 text-sm"/></label><div className="mt-3 max-h-[32rem] space-y-2 overflow-y-auto">{fornecedoresFiltrados.map((item) => { const marcado = pagamentos.some((pagamento) => String(pagamento.valor_em_aberto_id) === String(item.valor_em_aberto_id)); return <button key={item.valor_em_aberto_id} onClick={() => adicionarFornecedor(item)} disabled={marcado || fechado || salvando} className={`w-full rounded-xl border p-3 text-left ${marcado ? "border-[#175C4C]/20 bg-[#EDF4F1]" : "border-black/10 hover:border-[#175C4C]/40"}`}><span className="flex items-start gap-2"><span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${marcado ? "border-[#175C4C] bg-[#175C4C] text-white" : "border-black/20"}`}>{marcado && <Check size={11}/>}</span><span><strong className="block text-sm">{item.razao_social}</strong><small className="text-[#17352F]/50">NF {item.numero_nota_fiscal || "--"} · Valor em aberto <b>{formatBRL(item.valor_em_aberto)}</b></small></span></span></button>; })}</div><button onClick={() => setMostrarAvulso((atual) => !atual)} className="mt-3 w-full rounded-lg border border-dashed border-[#A35B35]/40 px-3 py-2 text-sm text-[#A35B35]"><Plus size={14} className="mr-1 inline"/> Fornecedor não cadastrado</button>{mostrarAvulso && <div className="mt-3 space-y-2 rounded-xl bg-[#FFF7EF] p-3"><input value={avulso.nome} onChange={(evento) => setAvulso({ ...avulso, nome: evento.target.value })} placeholder="Nome / razão social" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"/><CampoMoeda valor={avulso.valor} onValorChange={(valor) => setAvulso({ ...avulso, valor })} className="w-full rounded-lg border border-black/10 px-3 py-2 text-right text-sm"/><button onClick={adicionarAvulso} className="w-full rounded-lg bg-[#A35B35] px-3 py-2 text-sm text-white">Adicionar à relação</button></div>}</div>

              <div className="rounded-2xl border border-black/5 bg-white shadow-sm print:shadow-none"><div className="border-b border-black/5 p-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#A35B35]">Relação proposta</p><h2 className="font-serif text-xl font-semibold">Valores para aprovação</h2>{diferenca < 0 && <p className="mt-2 rounded-lg bg-[#FFF0E7] px-3 py-2 text-xs text-[#9B3E20]">A proposta excede o disponível em {formatBRL(Math.abs(diferenca))}. A edição e a impressão continuam liberadas.</p>}</div>{pagamentos.length === 0 ? <p className="p-8 text-center text-sm opacity-45">Nenhum fornecedor na relação.</p> : <div className="divide-y divide-black/5">{pagamentos.map((pagamento) => { const aberto = pagamento.valores_em_aberto ? Math.max(0, numero(pagamento.valores_em_aberto.valor) - numero(pagamento.valores_em_aberto.valor_pago)) : null; const resumo = resumoBaixas(pagamento.valor_a_pagar, baixasPorPagamento[String(pagamento.id)] ?? []); return <div key={pagamento.id} className="grid gap-3 p-4 md:grid-cols-[1fr_10rem_14rem_auto] md:items-center"><div><strong className="block text-sm">{nomePagamento(pagamento)}</strong><small className="text-[#17352F]/50">{aberto === null ? "Fornecedor não cadastrado" : `Valor em aberto: ${formatBRL(aberto)}`}</small><small className="block text-[#17352F]/50">Situação: {resumo.situacao === "pago" ? "Pago" : resumo.situacao === "parcialmente_pago" ? "Parcialmente pago" : "Em aberto"}</small></div><label className="text-xs">Valor a pagar<CampoMoeda valor={pagamento.valor_a_pagar} onValorChange={(valor) => editarValor(pagamento.id, valor)} disabled={fechado || pagamento.situacao === "pago"} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-2 text-right text-sm"/></label><label className="text-xs print:hidden">Conta de origem<select value={pagamento.conta_origem_id || ""} onChange={(evento) => definirContaPagamento(pagamento.id, evento.target.value)} disabled={fechado || pagamento.situacao === "pago"} className="mt-1 w-full rounded-lg border border-black/10 bg-white px-2 py-2 text-sm"><option value="">Indique a conta...</option>{contasSelecionadasComSaldo.map((conta) => <option key={conta.id} value={conta.id}>{conta.nome_conta} · {formatBRL(conta.saldo)}</option>)}</select></label><div className="flex gap-1 print:hidden">{pagamento.situacao !== "pago" && <button onClick={() => abrirBaixa(pagamento)} className="rounded-lg bg-[#175C4C] px-3 py-2 text-xs text-white">Efetuar</button>}{podeExcluir && pagamento.situacao !== "pago" && <button onClick={() => removerPagamento(pagamento)} className="rounded-lg border border-red-100 p-2 text-red-600"><Trash2 size={14}/></button>}</div></div>; })}</div>}<div className="grid grid-cols-3 gap-px bg-black/5"><div className="bg-[#F8F7F2] p-3 text-xs">Total disponível<strong className="block text-base">{formatBRL(totalDisponivel)}</strong></div><div className="bg-[#F8F7F2] p-3 text-xs">Total a pagar<strong className="block text-base">{formatBRL(totalPagar)}</strong></div><div className={`p-3 text-xs ${diferenca < 0 ? "bg-[#FFF0E7] text-[#9B3E20]" : "bg-[#EDF4F1]"}`}>Diferença<strong className="block text-base">{formatBRL(diferenca)}</strong></div></div></div>
            </section>

            <div className="mb-8 flex justify-end print:hidden"><button onClick={alternarFechamento} className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-4 py-2 text-sm">{fechado ? <Unlock size={14}/> : <Lock size={14}/>} {fechado ? "Reabrir programação" : "Fechar após efetivação"}</button></div>

            <section className="hidden print:block"><h1 className="font-serif text-2xl font-semibold">Relação para aprovação de pagamentos</h1><p className="mt-1 text-sm">{secretariaAtual} · {new Date(`${data}T00:00:00`).toLocaleDateString("pt-BR")}</p><h2 className="mt-6 border-b pb-2 font-semibold">Contas selecionadas</h2><table className="mt-2 w-full text-sm"><thead><tr><th className="text-left">Conta</th><th className="text-left">Banco</th><th className="text-left">Número</th><th className="text-right">Saldo</th></tr></thead><tbody>{contasSelecionadasComSaldo.map((conta) => <tr key={conta.id}><td className="py-1">{conta.nome_conta}</td><td>{conta.banco}</td><td>{conta.numero_conta || "--"}</td><td className="text-right">{formatBRL(conta.saldo)}</td></tr>)}</tbody><tfoot><tr className="border-t font-bold"><td className="pt-2" colSpan="3">Somatório dos saldos</td><td className="pt-2 text-right">{formatBRL(totalDisponivel)}</td></tr></tfoot></table><h2 className="mt-7 border-b pb-2 font-semibold">Relação de fornecedores</h2><table className="mt-2 w-full text-sm"><thead><tr><th className="text-left">Fornecedor</th><th className="w-32 text-right">Valor a pagar</th><th className="w-64 text-left">Anotações / alteração do chefe</th></tr></thead><tbody>{pagamentos.map((pagamento) => <tr key={pagamento.id} className="border-b"><td className="h-14">{nomePagamento(pagamento)}</td><td className="text-right">{formatBRL(pagamento.valor_a_pagar)}</td><td/></tr>)}</tbody><tfoot><tr className="font-bold"><td className="pt-2">Total a pagar</td><td className="pt-2 text-right">{formatBRL(totalPagar)}</td><td/></tr></tfoot></table></section>
          </>}
        </>}
      </div>
      {baixaPendente && <ModalBaixaPagamento pagamento={baixaPendente} fornecedores={fornecedores.map((item) => ({ id: item.id, razao_social: item.razao_social })).filter((item, indice, lista) => lista.findIndex((outro) => String(outro.id) === String(item.id)) === indice)} contas={contasSelecionadasComSaldo} contaSugeridaId={baixaPendente.conta_origem_id || destinoConcentracao} baixas={baixasPorPagamento[String(baixaPendente.id)] ?? []} onFechar={() => setBaixaPendente(null)} onConcluida={async () => { setBaixaPendente(null); await carregarBase(); await carregarProgramacao(); }}/>} 
    </Layout>
  );
}
