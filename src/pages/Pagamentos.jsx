import React from "react";
import { Plus, X, Trash2, Check, ChevronRight, Pencil, Printer, FileText, FileSpreadsheet, Copy, Lock, Unlock, Search, ArrowRightLeft } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabaseClient";
import Layout from "../components/Layout";
import PainelFiltros from "../components/comuns/PainelFiltros";
import CampoMoeda from "../components/CampoMoeda";
import { formatBRL, paraNumeroMoeda, FORMATO_MOEDA_PLANILHA } from "../lib/moeda";
import { mensagemAmigavel, erroAmigavel } from "../lib/erros";
import { usePermissaoModulo } from "../lib/permissoes";
import ModalConfirmarExclusao from "../components/comuns/ModalConfirmarExclusao";
import { auditarExclusao, excluirRegistro, filtroVigentes } from "../lib/exclusaoRegistros";
import {
  TOLERANCIA,
  emCentavos,
  somar,
  textoSaldoInsuficiente,
} from "../lib/rateioPagamentos";
import { montarSaldosDasContas } from "../lib/saldosContas";
import {
  buscarReservasPorConta,
  buscarSaldoRealPorConta,
  estruturaDeRateioAusente,
} from "../lib/saldosContasDados";
import { calcularConferenciaTransferencias, confirmarTransferencias, estornarTransferencia } from "../lib/transferenciasContas";
import { listarFormasPagamento, resumirFormaPagamento } from "../lib/dadosPagamentoFornecedor";
import { usePermissoesEspeciais } from "../lib/permissoesEspeciais";
import ModalBaixaPagamento from "../components/pagamentos/ModalBaixaPagamento";
import { resumoBaixas } from "../lib/regrasBaixas";

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

// Aviso usado quando o banco deste ambiente ainda não recebeu a estrutura nova.
const AVISO_RATEIO_INDISPONIVEL = "A estrutura de conta de pagamento e transferências ainda não está disponível neste ambiente.";

function textoConta(conta) {
  return `${conta.nome_conta ?? ""} ${conta.banco ?? ""} ${conta.numero_conta ?? ""} ${conta.secretaria ?? ""}`
    .toLocaleLowerCase("pt-BR");
}

function LinhaContaSelecao({ conta, tipo, selecionada, desabilitada, onChange }) {
  const controle = tipo === "radio" ? "radio" : "checkbox";
  return (
    <label
      className={`grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-3 px-3 py-3 transition-colors sm:grid-cols-[auto_minmax(0,1fr)_auto] ${
        selecionada ? "bg-[#EAF1F5] ring-1 ring-inset ring-[#0F2A44]/25" : "hover:bg-[#F7F9FA]"
      } ${desabilitada ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <input
        type={controle}
        name={tipo === "radio" ? "conta-pagamento" : undefined}
        checked={selecionada}
        disabled={desabilitada}
        onChange={onChange}
        className="mt-1 h-4 w-4 accent-[#0F2A44]"
      />
      <span className="min-w-0">
        <strong className="block truncate text-sm font-semibold text-[#0F2A44]">{conta.nome_conta || "Conta sem nome"}</strong>
        <span className="mt-1 grid gap-x-4 gap-y-1 text-[11px] text-[#0F2A44]/60 sm:grid-cols-3">
          <span><span className="font-medium text-[#0F2A44]/40">Banco</span><br />{conta.banco || "--"}</span>
          <span><span className="font-medium text-[#0F2A44]/40">Conta</span><br />{conta.numero_conta || "--"}</span>
          <span><span className="font-medium text-[#0F2A44]/40">Secretaria</span><br />{conta.secretaria || "--"}</span>
        </span>
      </span>
      <span className="col-start-2 text-left sm:col-start-3 sm:row-start-1 sm:text-right">
        <span className="block text-[10px] uppercase tracking-wide text-[#0F2A44]/40">Saldo atual</span>
        <strong className="text-sm tabular-nums text-[#0F2A44]">{formatBRL(conta.saldoHoje)}</strong>
      </span>
    </label>
  );
}

export default function Pagamentos() {
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);

  // Exclusão: nada sai da tela sem a confirmação padrão, e pagamento é registro
  // sensível — o motivo é obrigatório e vai junto para a auditoria.
  const [exclusaoPendente, setExclusaoPendente] = React.useState(null);
  const { usuario: usuarioLogado, permissao: permissaoPagamentos } =
    usePermissaoModulo("pagamentos");
  const podeExcluir = permissaoPagamentos?.pode_excluir === true;
  const { valores: permissoesEspeciais } = usePermissoesEspeciais();

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
  const [contaPagamentoId, setContaPagamentoId] = React.useState("");
  const [buscaContaPagamento, setBuscaContaPagamento] = React.useState("");
  const [filtroBancoPagamento, setFiltroBancoPagamento] = React.useState("");
  const [buscaConta, setBuscaConta] = React.useState("");
  const [filtroBancoConta, setFiltroBancoConta] = React.useState("");
  const [filtroSecretariaConta, setFiltroSecretariaConta] = React.useState("");
  const [pagamentos, setPagamentos] = React.useState([]);
  const [baixasPorPagamento, setBaixasPorPagamento] = React.useState({});
  const [baixaPendente, setBaixaPendente] = React.useState(null);
  const [transferenciasRealizadas, setTransferenciasRealizadas] = React.useState([]);
  const [fechado, setFechado] = React.useState(false);

  // Contas de origem e valores de transferência ainda não confirmados.
  const [contasDaProgramacao, setContasDaProgramacao] = React.useState([]);
  const [rateioLocal, setRateioLocal] = React.useState({});
  const [rateioSalvo, setRateioSalvo] = React.useState({});
  const [salvandoRateio, setSalvandoRateio] = React.useState(false);
  const [rateioIndisponivel, setRateioIndisponivel] = React.useState(false);

  // Por conta: quanto outras programações do dia reservaram e quanto esta
  // programação já debitou de verdade (Map montado pela fonte única de saldo).
  const [reservaPorConta, setReservaPorConta] = React.useState(new Map());

  const [mostrarAddCadastrado, setMostrarAddCadastrado] = React.useState(false);
  const [mostrarAddAvulso, setMostrarAddAvulso] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);

  const [fornecedorEscolhido, setFornecedorEscolhido] = React.useState("");
  const [valorEmAbertoEscolhido, setValorEmAbertoEscolhido] = React.useState("");
  const [formasPagamentoFornecedor, setFormasPagamentoFornecedor] = React.useState([]);
  const [formaPagamentoId, setFormaPagamentoId] = React.useState("");
  const [avulso, setAvulso] = React.useState({ nome: "", descricao: "", valor: "" });

  const [mostrarCopiar, setMostrarCopiar] = React.useState(false);
  const [programacoesParaCopiar, setProgramacoesParaCopiar] = React.useState([]);
  const [programacaoParaCopiarId, setProgramacaoParaCopiarId] = React.useState("");

  const timersRef = React.useRef({});
  const transferindoRef = React.useRef(false);

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
    let ativo = true;
    if (!fornecedorEscolhido) {
      setFormasPagamentoFornecedor([]);
      setFormaPagamentoId("");
      return () => { ativo = false; };
    }
    listarFormasPagamento(fornecedorEscolhido)
      .then((formas) => {
        if (!ativo) return;
        setFormasPagamentoFornecedor(formas ?? []);
        setFormaPagamentoId((formas ?? []).find((forma) => forma.isPrimary)?.id ?? "");
      })
      .catch(() => { if (ativo) setFormasPagamentoFornecedor([]); });
    return () => { ativo = false; };
  }, [fornecedorEscolhido]);

  React.useEffect(() => {
    if (programacaoAtualId) {
      carregarProgramacaoAtual();
    } else {
      setContasSelecionadas(new Set());
      setContasDaProgramacao([]);
      setRateioLocal({});
      setRateioSalvo({});
      setPagamentos([]);
      setFechado(false);
      setContasFinalizadas(false);
    }
  }, [programacaoAtualId]);

  React.useEffect(() => {
    if (programacaoAtualId && permissoesEspeciais.visualizar_baixas) carregarProgramacaoAtual();
  }, [permissoesEspeciais.visualizar_baixas]);

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
      setErro(mensagemAmigavel(e, "Não foi possível carregar as secretarias."));
    } finally {
      setCarregando(false);
    }
  }

  async function carregarContasEFornecedores(secId) {
    try {
      const { data: contas, error: eContas } = await supabase
        .from("contas_bancarias")
        .select("id, nome_conta, numero_conta, banco_id, secretaria_id, bancos(nome)")
        .eq("secretaria_id", secId)
        .eq("ativo", true);
      if (eContas) throw eContas;

      // Saldo Real das contas pela fonte única (consulta paginada, um registro
      // por conta): o mesmo número que o Painel Principal e Saldos das Contas.
      const saldos = await buscarSaldoRealPorConta({ contaIds: (contas ?? []).map((c) => c.id) });

      const contasComSaldo = montarSaldosDasContas(
        (contas ?? []).map((c) => ({
          id: c.id,
          nome_conta: c.nome_conta,
          numero_conta: c.numero_conta,
          banco: c.bancos?.nome ?? "--",
          secretaria: secretarias.find((s) => String(s.id) === String(c.secretaria_id))?.nome ?? "--",
          secretaria_id: c.secretaria_id,
        })),
        { saldos }
      );
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
      setErro(mensagemAmigavel(e, "Não foi possível carregar as contas e os fornecedores desta secretaria."));
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

      await calcularReservasDoDia(progs ?? []);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível carregar as programações deste dia."));
    }
  }

  /**
   * Reserva por conta: o que cada programação do dia rateou para a conta e
   * ainda não virou débito. É esse valor que sai do saldo disponível das outras
   * programações -- nunca o valor total do pagamento repetido em cada conta.
   */
  async function calcularReservasDoDia(progs) {
    if (!progs || progs.length === 0) {
      setReservaPorConta(new Map());
      return;
    }
    try {
      const { reservas, rateioIndisponivel: semRateio } = await buscarReservasPorConta({
        programacaoIds: progs.map((p) => p.id),
      });
      setRateioIndisponivel(semRateio);
      setReservaPorConta(reservas);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível calcular o saldo já reservado por outras programações."));
    }
  }

  async function carregarProgramacaoAtual() {
    setErro(null);
    setTransferenciasRealizadas([]);
    try {
      let { data: prog, error: eProg } = await supabase
        .from("programacoes_pagamento")
        .select("id, fechado, conta_pagamento_id")
        .eq("id", programacaoAtualId)
        .single();

      if (eProg && estruturaDeRateioAusente(eProg)) {
        console.error("[Pagamentos] Estrutura nova ausente ao carregar a programação; usando dados legados.", {
          programacaoId: programacaoAtualId,
          erro: eProg,
        });
        const resultadoLegado = await supabase
          .from("programacoes_pagamento")
          .select("id, fechado")
          .eq("id", programacaoAtualId)
          .single();
        prog = resultadoLegado.data ? { ...resultadoLegado.data, conta_pagamento_id: null } : null;
        eProg = resultadoLegado.error;
      }
      if (eProg) throw eProg;

      setFechado(prog?.fechado === true);
      setContaPagamentoId(prog?.conta_pagamento_id ?? "");

      let linhasDeContas = [];
      try {
        const { data: pc, error: ePc } = await supabase
          .from("programacao_contas")
          .select("conta_id, valor_transferir, ordem")
          .eq("programacao_id", programacaoAtualId);
        if (ePc) {
          if (!estruturaDeRateioAusente(ePc)) throw ePc;
          console.error("[Pagamentos] Campos de transferência ausentes; carregando somente as contas legadas.", {
            programacaoId: programacaoAtualId,
            erro: ePc,
          });
          setRateioIndisponivel(true);
          const { data: simples, error: eSimples } = await supabase
            .from("programacao_contas")
            .select("conta_id")
            .eq("programacao_id", programacaoAtualId);
          if (eSimples) throw eSimples;
          linhasDeContas = (simples ?? []).map((r) => ({ ...r, valor_transferir: 0, ordem: null }));
        } else {
          linhasDeContas = pc ?? [];
        }
      } catch (erroContas) {
        console.error("[Pagamentos] Não foi possível carregar as contas vinculadas; mantendo a programação aberta.", {
          programacaoId: programacaoAtualId,
          erro: erroContas,
        });
        linhasDeContas = [];
      }

      const ordenadas = [...(linhasDeContas ?? [])].sort(
        (a, b) =>
          (a.ordem ?? Number.MAX_SAFE_INTEGER) - (b.ordem ?? Number.MAX_SAFE_INTEGER) ||
          String(a.conta_id).localeCompare(String(b.conta_id))
      );
      setContasDaProgramacao(ordenadas);

      const rateio = {};
      for (const r of ordenadas) rateio[r.conta_id] = emCentavos(paraNumeroMoeda(r.valor_transferir));
      setRateioLocal(rateio);
      setRateioSalvo(rateio);

      const setContas = new Set(ordenadas.map((r) => r.conta_id));
      setContasSelecionadas(setContas);
      setContasFinalizadas(setContas.size > 0);

      // Pagamento excluído (exclusão lógica) não volta para a lista nem entra
      // em nenhuma soma da programação.
      const vigentes = await filtroVigentes("pagamentos");
      let { data: pgs, error: ePgs } = await vigentes(
        supabase
          .from("pagamentos")
          .select("id, fornecedor_id, valor_em_aberto_id, valor_a_pagar, situacao, nome_avulso, descricao, forma_pagamento_id, forma_pagamento_resumo, fornecedores(razao_social), valores_em_aberto(numero_nota_fiscal)")
          .eq("programacao_id", programacaoAtualId)
          .order("created_at", { ascending: true }),
      );
      if (ePgs && estruturaDeRateioAusente(ePgs)) {
        console.error("[Pagamentos] Campos novos de pagamento ausentes; usando a estrutura legada.", {
          programacaoId: programacaoAtualId,
          erro: ePgs,
        });
        const resultadoLegado = await vigentes(
          supabase
            .from("pagamentos")
            .select("id, fornecedor_id, valor_em_aberto_id, valor_a_pagar, situacao, nome_avulso, descricao, fornecedores(razao_social), valores_em_aberto(numero_nota_fiscal)")
            .eq("programacao_id", programacaoAtualId)
            .order("created_at", { ascending: true }),
        );
        pgs = (resultadoLegado.data ?? []).map((pagamento) => ({
          ...pagamento,
          forma_pagamento_id: null,
          forma_pagamento_resumo: null,
        }));
        ePgs = resultadoLegado.error;
      }
      if (ePgs) throw ePgs;
      setPagamentos(pgs ?? []);
      const idsPagamentos = (pgs ?? []).map((pagamento) => String(pagamento.id));
      if (idsPagamentos.length > 0 && permissoesEspeciais.visualizar_baixas) {
        const { data: baixas, error: erroBaixas } = await supabase
          .from("pagamentos_baixas")
          .select("id,pagamento_id,valor_pago,data_pagamento,conta_id,usuario_id,status,criado_em,motivo_estorno,contas_bancarias(nome_conta,numero_conta,bancos(nome)),usuarios(nome_completo)")
          .in("pagamento_id", idsPagamentos)
          .order("data_pagamento", { ascending: false });
        if (erroBaixas) {
          console.error("[Pagamentos] Histórico de baixas indisponível.", erroBaixas);
          setBaixasPorPagamento({});
        } else {
          setBaixasPorPagamento((baixas ?? []).reduce((mapa, baixa) => {
            (mapa[String(baixa.pagamento_id)] ??= []).push(baixa);
            return mapa;
          }, {}));
        }
      } else {
        setBaixasPorPagamento({});
      }
      const { data: transferencias, error: erroTransferencias } = await supabase.from("transferencias_contas").select("id,conta_origem_id,conta_destino_id,valor,criada_em,observacao,estornada_em,transferencia_original_id").eq("programacao_id", programacaoAtualId).order("criada_em", { ascending: false });
      if (erroTransferencias) {
        console.error("[Pagamentos] Histórico de transferências indisponível; mantendo a programação aberta.", {
          programacaoId: programacaoAtualId,
          erro: erroTransferencias,
        });
      } else {
        setTransferenciasRealizadas(transferencias ?? []);
      }
    } catch (e) {
      console.error("[Pagamentos] Falha ao carregar os dados essenciais da programação.", {
        programacaoId: programacaoAtualId,
        erro: e,
      });
      setErro(mensagemAmigavel(e, "Não foi possível carregar os pagamentos desta programação."));
    }
  }

  async function fecharMovimento() {
    setErro(null);

    if (!contaPagamentoId) {
      setErro("Escolha a conta de pagamento desta programação antes de fechar o movimento.");
      return;
    }
    if (saldoInsuficiente) {
      setErro(textoSaldoInsuficiente(saldoDisponivel, totalProgramado));
      return;
    }
    if (somaDoRateio > TOLERANCIA) {
      setErro("Existem valores de transferência informados e ainda não confirmados.");
      return;
    }
    if (!confirm("Fechar o movimento deste dia? A programação ficará somente para leitura até ser reaberta.")) return;
    setSalvando(true);
    try {
      const { error } = await supabase
        .from("programacoes_pagamento")
        .update({ fechado: true })
        .eq("id", programacaoAtualId);
      if (error) throw error;
      setFechado(true);
      await carregarProgramacoesDoDia();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível fechar o movimento do dia."));
    } finally {
      setSalvando(false);
    }
  }

  async function reabrirMovimento() {
    if (!confirm("Reabrir esta programação para edição?")) return;
    setSalvando(true);
    setErro(null);
    try {
      const { error } = await supabase
        .from("programacoes_pagamento")
        .update({ fechado: false })
        .eq("id", programacaoAtualId);
      if (error) throw error;
      setFechado(false);
      await carregarProgramacoesDoDia();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível reabrir esta programação."));
    } finally {
      setSalvando(false);
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
      setErro(mensagemAmigavel(e, "Não foi possível criar a programação."));
    } finally {
      setSalvando(false);
    }
  }

  /** Abre a confirmação de exclusão da programação (e de tudo lançado nela). */
  function excluirProgramacao(progId) {
    const programacao = programacoesDoDia.find((p) => String(p.id) === String(progId));
    const nome = programacao?.nome_programacao || "Sem nome";
    const secretaria = secretarias.find((sec) => String(sec.id) === String(secretariaId));
    setExclusaoPendente({
      tipo: "programacao",
      id: progId,
      rotulo: `${nome} — ${secretaria?.nome ?? "Secretaria"} (${data})`,
      registro: `a programação "${nome}" e todos os pagamentos lançados nela`,
      aviso:
        "A programação, as contas escolhidas para ela e os pagamentos ainda não efetivados são apagados.",
      exigirMotivo: true,
      detalhes: [
        { rotulo: "Programação", valor: nome },
        { rotulo: "Secretaria", valor: secretaria?.nome ?? "--" },
        { rotulo: "Data", valor: data },
      ],
      anterior: {
        titulo: nome,
        secretaria: secretaria?.nome ?? null,
        data_pagamento: data,
      },
    });
  }

  /** Abre a confirmação de exclusão de um pagamento da programação aberta. */
  function removerPagamento(pagamentoId) {
    const pagamento = pagamentos.find((p) => String(p.id) === String(pagamentoId));
    if (!pagamento) return;
    if (pagamento.situacao === "pago") {
      setErro("Este pagamento já foi efetivado e debitado nas contas. Não é possível removê-lo.");
      return;
    }

    const nome = pagamento.fornecedores?.razao_social || pagamento.nome_avulso || "Pagamento avulso";
    const nota = pagamento.valores_em_aberto?.numero_nota_fiscal ?? null;
    setExclusaoPendente({
      tipo: "pagamento",
      id: pagamentoId,
      rotulo: nota ? `${nome} — NF ${nota}` : nome,
      registro: `o pagamento de ${nome}`,
      aviso: "O pagamento sai da programação e deixa de contar no total programado do dia.",
      exigirMotivo: true,
      detalhes: [
        { rotulo: "Fornecedor", valor: nome },
        { rotulo: "Nota fiscal", valor: nota ?? "--" },
        { rotulo: "Valor", valor: formatBRL(paraNumeroMoeda(pagamento.valor_a_pagar)) },
        { rotulo: "Descrição", valor: pagamento.descricao ?? "" },
      ],
      anterior: {
        fornecedor: nome,
        valor: formatBRL(paraNumeroMoeda(pagamento.valor_a_pagar)),
        situacao: pagamento.situacao === "pago" ? "Pago" : "Pendente",
      },
    });
  }

  /**
   * Executa a exclusão confirmada no modal e registra o evento na auditoria.
   *
   * O pagamento é excluído logicamente (excluido_em/excluido_por): ele some da
   * programação mas continua no banco. A programação em si continua sendo
   * exclusão física, como sempre foi — e nunca pode ser excluída quando já tem
   * pagamento efetivado, porque o débito em conta ficaria sem origem.
   */
  async function confirmarExclusao(motivo) {
    const pendente = exclusaoPendente;
    if (!pendente) return;
    setErro(null);

    if (pendente.tipo === "pagamento") {
      const pagamento = pagamentos.find((p) => String(p.id) === String(pendente.id));
      if (pagamento?.situacao === "pago") {
        throw erroAmigavel(
          "Este pagamento já foi efetivado e debitado nas contas. Não é possível removê-lo."
        );
      }

      const { logica } = await excluirRegistro({
        tabela: "pagamentos",
        id: pendente.id,
        usuarioId: usuarioLogado?.id ?? null,
      });

      await auditarExclusao({
        modulo: "pagamentos",
        registroAfetado: pendente.rotulo,
        motivo,
        valorAnterior: pendente.anterior,
        logica,
        nivel: "critico",
        usuarioId: usuarioLogado?.id ?? null,
      });

      setExclusaoPendente(null);
      await carregarProgramacaoAtual();
      await carregarProgramacoesDoDia();
      return;
    }

    // Pagamento já efetivado saiu do saldo da conta: apagar aqui deixaria o
    // débito sem origem, então a exclusão é barrada.
    const vigentes = await filtroVigentes("pagamentos");
    const { data: pagos, error: ePagos } = await vigentes(
      supabase
        .from("pagamentos")
        .select("id")
        .eq("programacao_id", pendente.id)
        .eq("situacao", "pago")
        .limit(1),
    );
    if (ePagos) throw ePagos;
    if (pagos && pagos.length > 0) {
      throw erroAmigavel(
        "Esta programação já tem pagamento efetivado e debitado em conta. Não é possível excluí-la."
      );
    }

    await supabase.from("pagamentos").delete().eq("programacao_id", pendente.id);
    await supabase.from("programacao_contas").delete().eq("programacao_id", pendente.id);
    const { error } = await supabase.from("programacoes_pagamento").delete().eq("id", pendente.id);
    if (error) throw error;

    await auditarExclusao({
      modulo: "pagamentos",
      registroAfetado: pendente.rotulo,
      motivo,
      valorAnterior: pendente.anterior,
      logica: false,
      nivel: "critico",
      usuarioId: usuarioLogado?.id ?? null,
    });

    setExclusaoPendente(null);
    setProgramacaoAtualId(null);
    await carregarProgramacoesDoDia();
  }

  async function abrirCopiarProgramacao() {
    setMostrarCopiar((v) => !v);
    setMostrarNovaProgramacao(false);
    if (!mostrarCopiar) {
      try {
        const { data: progs, error } = await supabase
          .from("programacoes_pagamento")
          .select("id, nome_programacao, data_programacao")
          .eq("secretaria_id", secretariaId)
          .order("data_programacao", { ascending: false })
          .limit(50);
        if (error) throw error;
        setProgramacoesParaCopiar(progs ?? []);
      } catch (e) {
        setErro(mensagemAmigavel(e, "Não foi possível buscar as programações anteriores."));
      }
    }
  }

  async function copiarProgramacao() {
    if (!programacaoParaCopiarId) {
      setErro("Selecione uma programação para copiar.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const origem = programacoesParaCopiar.find((p) => p.id === programacaoParaCopiarId);

      const { data: userData } = await supabase.auth.getUser();
      const { data: nova, error: eNova } = await supabase
        .from("programacoes_pagamento")
        .insert({
          secretaria_id: secretariaId,
          data_programacao: data,
          responsavel_id: userData.user.id,
          nome_programacao: origem?.nome_programacao
            ? `${origem.nome_programacao} (cópia)`
            : "Cópia de programação",
        })
        .select()
        .single();
      if (eNova) throw eNova;

      const { data: contasOrigem, error: eContasOrigem } = await supabase
        .from("programacao_contas")
        .select("conta_id, ordem")
        .eq("programacao_id", programacaoParaCopiarId);
      if (eContasOrigem && !estruturaDeRateioAusente(eContasOrigem)) throw eContasOrigem;

      let contasParaCopiar = contasOrigem;
      if (eContasOrigem) {
        const { data: simples, error: eSimples } = await supabase
          .from("programacao_contas")
          .select("conta_id")
          .eq("programacao_id", programacaoParaCopiarId);
        if (eSimples) throw eSimples;
        contasParaCopiar = simples;
      }

      if (contasParaCopiar && contasParaCopiar.length > 0) {
        // Valores de transferência não são copiados para a nova programação.
        const novasContas = contasParaCopiar.map((c, i) => ({
          programacao_id: nova.id,
          conta_id: c.conta_id,
          ...(eContasOrigem ? {} : { ordem: c.ordem ?? i + 1, valor_transferir: 0 }),
        }));
        const { error: eInsContas } = await supabase.from("programacao_contas").insert(novasContas);
        if (eInsContas) throw eInsContas;
      }

      const vigentesOrigem = await filtroVigentes("pagamentos");
      const { data: pagamentosOrigem, error: ePagOrigem } = await vigentesOrigem(
        supabase
          .from("pagamentos")
          .select("fornecedor_id, valor_em_aberto_id, valor_a_pagar, nome_avulso, descricao")
          .eq("programacao_id", programacaoParaCopiarId),
      );
      if (ePagOrigem) throw ePagOrigem;

      if (pagamentosOrigem && pagamentosOrigem.length > 0) {
        const novosPagamentos = pagamentosOrigem.map((p) => ({
          programacao_id: nova.id,
          fornecedor_id: p.fornecedor_id,
          valor_em_aberto_id: p.valor_em_aberto_id,
          valor_a_pagar: p.valor_a_pagar,
          nome_avulso: p.nome_avulso,
          descricao: p.descricao,
          situacao: "pendente",
        }));
        const { error: eInsPag } = await supabase.from("pagamentos").insert(novosPagamentos);
        if (eInsPag) throw eInsPag;
      }

      setMostrarCopiar(false);
      setProgramacaoParaCopiarId("");
      await carregarProgramacoesDoDia();
      setProgramacaoAtualId(nova.id);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível copiar a programação."));
    } finally {
      setSalvando(false);
    }
  }

  async function toggleConta(contaId) {
    if (!programacaoAtualId || fechado) return;
    setErro(null);
    try {
      const jaSelecionada = contasSelecionadas.has(contaId);

      if (jaSelecionada) {
        const jaDebitado =
          reservaPorConta.get(String(contaId))?.debitadoPorProgramacao?.[String(programacaoAtualId)] ?? 0;
        if (jaDebitado > 0) {
          throw erroAmigavel(
            "Esta conta já foi debitada por um pagamento efetivado desta programação e não pode ser retirada."
          );
        }

        const { error } = await supabase
          .from("programacao_contas")
          .delete()
          .eq("programacao_id", programacaoAtualId)
          .eq("conta_id", contaId);
        if (error) throw error;
      } else {
        const proximaOrdem =
          contasDaProgramacao.reduce((maior, c) => Math.max(maior, c.ordem ?? 0), 0) + 1;
        const { error } = await supabase.from("programacao_contas").insert({
          programacao_id: programacaoAtualId,
          conta_id: contaId,
          ...(rateioIndisponivel ? {} : { ordem: proximaOrdem, valor_transferir: 0 }),
        });
        if (error) throw error;
      }

      // Recarrega para manter seleção, ordem e valores em sincronia.
      await carregarProgramacaoAtual();
      await carregarProgramacoesDoDia();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível alterar as contas desta programação."));
    }
  }

  async function selecionarTodasContas() {
    if (!programacaoAtualId || fechado) return;
    const novas = contasFiltradas.filter((conta) => !contasSelecionadas.has(conta.id));
    if (!novas.length) return;
    const inicio = contasDaProgramacao.reduce((maior, conta) => Math.max(maior, conta.ordem ?? 0), 0);
    const { error } = await supabase.from("programacao_contas").insert(novas.map((conta, indice) => ({ programacao_id: programacaoAtualId, conta_id: conta.id, ordem: inicio + indice + 1, valor_transferir: 0 })));
    if (error) { setErro(mensagemAmigavel(error, "Não foi possível selecionar todas as contas.")); return; }
    await carregarProgramacaoAtual();
  }

  async function abrirAddCadastrado() {
    setMostrarAddCadastrado((v) => !v);
    setMostrarAddAvulso(false);
    if (!mostrarAddCadastrado) {
      await carregarContasEFornecedores(secretariaId);
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
      const fornecedor = fornecedoresDaSecretaria.find((f) => String(f.id) === String(fornecedorEscolhido));
      const valorObj = fornecedor?.valores.find((v) => String(v.id) === String(valorEmAbertoEscolhido));
      const restante = (valorObj?.valor ?? 0) - (valorObj?.valor_pago ?? 0);

      const { error } = await supabase.from("pagamentos").insert({
        programacao_id: programacaoAtualId,
        fornecedor_id: fornecedorEscolhido,
        valor_em_aberto_id: valorEmAbertoEscolhido,
        valor_a_pagar: restante,
        situacao: "pendente",
        forma_pagamento_id: formaPagamentoId || null,
        forma_pagamento_resumo: formaPagamentoId ? resumirFormaPagamento(formasPagamentoFornecedor.find((forma) => forma.id === formaPagamentoId)) : null,
      });
      if (error) throw error;

      setFornecedorEscolhido("");
      setValorEmAbertoEscolhido("");
      setFormaPagamentoId("");
      setMostrarAddCadastrado(false);
      await carregarProgramacaoAtual();
      await carregarProgramacoesDoDia();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível adicionar o pagamento."));
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
        valor_a_pagar: paraNumeroMoeda(avulso.valor),
        situacao: "pendente",
      });
      if (error) throw error;

      setAvulso({ nome: "", descricao: "", valor: "" });
      setMostrarAddAvulso(false);
      await carregarProgramacaoAtual();
      await carregarProgramacoesDoDia();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível adicionar o pagamento."));
    } finally {
      setSalvando(false);
    }
  }

  function editarValorLocal(pagamentoId, novoValor) {
    const numero = paraNumeroMoeda(novoValor);
    setPagamentos((atual) =>
      atual.map((p) => (p.id === pagamentoId ? { ...p, valor_a_pagar: numero } : p))
    );

    clearTimeout(timersRef.current[pagamentoId]);
    timersRef.current[pagamentoId] = setTimeout(async () => {
      try {
        const { error } = await supabase
          .from("pagamentos")
          .update({ valor_a_pagar: numero })
          .eq("id", pagamentoId);
        if (error) throw error;
        await carregarProgramacoesDoDia();
      } catch (e) {
        setErro(mensagemAmigavel(e, "Não foi possível salvar o valor deste pagamento."));
      }
    }, 600);
  }

  function editarRateioLocal(contaId, novoValor) {
    setRateioLocal((atual) => ({ ...atual, [contaId]: emCentavos(novoValor) }));
  }

  /** Grava apenas a intenção informada; nenhum saldo é movimentado nesta etapa. */
  async function persistirRateio(valores) {
    if (rateioIndisponivel) throw erroAmigavel(AVISO_RATEIO_INDISPONIVEL);

    const alteradas = Object.entries(valores).filter(
      ([contaId, valor]) => emCentavos(valor) !== emCentavos(rateioSalvo[contaId])
    );

    for (const [contaId, valor] of alteradas) {
      const { error } = await supabase
        .from("programacao_contas")
        .update({ valor_transferir: emCentavos(valor) })
        .eq("programacao_id", programacaoAtualId)
        .eq("conta_id", contaId);
      if (error) throw error;
    }

    setRateioSalvo((atual) => ({ ...atual, ...valores }));
    setContasDaProgramacao((atual) =>
      atual.map((c) =>
        c.conta_id in valores ? { ...c, valor_transferir: emCentavos(valores[c.conta_id]) } : c
      )
    );
    await carregarProgramacoesDoDia();
  }

  async function salvarRateio() {
    await persistirRateio(rateioLocal);
  }

  async function salvarRateioNaTela() {
    setSalvandoRateio(true);
    setErro(null);
    try {
      await salvarRateio();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível salvar os valores de transferência."));
    } finally {
      setSalvandoRateio(false);
    }
  }

  async function definirContaPagamento(id) {
    setErro(null);
    const contaId = id || null;
    const { data: resultado, error } = await supabase.rpc("definir_conta_pagamento_programacao", {
      p_programacao_id: programacaoAtualId,
      p_conta_id: contaId,
    });
    if (error) {
      console.error("[Pagamentos] Erro do Supabase ao definir a conta de pagamento.", {
        programacaoId: programacaoAtualId,
        contaId,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      throw error;
    }
    if (resultado?.ok === false) throw erroAmigavel(resultado?.mensagem || "Não foi possível definir a conta de pagamento.");
    setContaPagamentoId(contaId ?? "");
    if (contaId && contasSelecionadas.has(contaId)) {
      try {
        await toggleConta(contaId);
      } catch (falhaRemocao) {
        console.error("[Pagamentos] A conta de pagamento foi definida, mas não pôde ser removida das contas de origem.", falhaRemocao);
      }
    }
    await carregarProgramacoesDoDia();
  }

  async function confirmarTransferenciasNaTela() {
    if (transferindoRef.current || somaDoRateio <= 0) return;
    if (!permissoesEspeciais.executar_transferencia) { setErro("Você não possui permissão para executar transferências."); return; }
    if (!contaPagamentoId) { setErro("Escolha primeiro a conta de pagamento."); return; }
    const transferencias = contasSelecionadasComSaldo.filter((conta) => emCentavos(rateioLocal[conta.id]) > 0).map((conta) => ({ sourceAccountId: conta.id, amount: emCentavos(rateioLocal[conta.id]) }));
    const invalida = transferencias.find((item) => item.amount > (contasSelecionadasComSaldo.find((conta) => conta.id === item.sourceAccountId)?.saldoHoje ?? 0));
    if (invalida) { setErro("O valor a transferir não pode superar o saldo disponível da conta de origem."); return; }
    if (!confirm(`Confirmar ${transferencias.length} transferência(s), totalizando ${formatBRL(somaDoRateio)}?`)) return;
    transferindoRef.current = true; setSalvandoRateio(true); setErro(null);
    try {
      if (temRateioNaoSalvo) await salvarRateio();
      await confirmarTransferencias({ programId: programacaoAtualId, destinationAccountId: contaPagamentoId, transfers: transferencias, idempotencyKey: crypto.randomUUID(), note: `Programação diária de ${data}` });
      setRateioLocal({}); setRateioSalvo({});
      await carregarContasEFornecedores(secretariaId); await carregarProgramacaoAtual(); await carregarProgramacoesDoDia();
    } catch (e) { setErro(mensagemAmigavel(e, "Não foi possível confirmar as transferências.")); }
    finally { transferindoRef.current = false; setSalvandoRateio(false); }
  }

  async function estornarTransferenciaNaTela(transferencia) {
    if (!permissoesEspeciais.estornar_transferencia || transferencia.estornada_em || transferencia.transferencia_original_id) return;
    const motivo = prompt("Informe a observação do estorno:");
    if (!motivo?.trim()) return;
    if (!confirm(`Estornar a transferência de ${formatBRL(transferencia.valor)}?`)) return;
    setErro(null);
    try {
      await estornarTransferencia(transferencia.id, motivo.trim());
      await carregarContasEFornecedores(secretariaId); await carregarProgramacaoAtual(); await carregarProgramacoesDoDia();
    } catch (e) { setErro(mensagemAmigavel(e, "Não foi possível estornar a transferência.")); }
  }

  function nomeDaConta(contaId) {
    const conta = contasDaSecretaria.find((c) => String(c.id) === String(contaId));
    return conta ? `${conta.banco} · ${conta.nome_conta}` : "";
  }

  function exportarExcel() {
    const linhas = pagamentos.map((p) => ({
      Fornecedor: p.fornecedores?.razao_social ?? p.nome_avulso,
      "Valor a pagar": paraNumeroMoeda(p.valor_a_pagar),
      Situação: p.situacao === "pago" ? "Pago" : "Pendente",
    }));
    linhas.push({ Fornecedor: "TOTAL PROGRAMADO", "Valor a pagar": totalProgramado, Situação: "" });
    linhas.push({ Fornecedor: "SALDO DISPONÍVEL", "Valor a pagar": saldoDisponivel, Situação: "" });
    linhas.push({ Fornecedor: "RESTA", "Valor a pagar": saldoRestante, Situação: "" });

    // Transferências ainda informadas na conferência da programação.
    contasSelecionadasComSaldo.forEach((c) => {
      linhas.push({
        Fornecedor: `TRANSFERÊNCIA PREVISTA -- ${c.banco} · ${c.nome_conta}`,
        "Valor a pagar": emCentavos(rateioLocal[c.id] ?? 0),
        Situação: "",
      });
    });
    linhas.push({ Fornecedor: "TOTAL A TRANSFERIR", "Valor a pagar": somaDoRateio, Situação: "" });

    const ws = XLSX.utils.json_to_sheet(linhas);

    // A coluna de valores sai como número, mas exibida em R$ 1.000.000,00.
    const alcance = XLSX.utils.decode_range(ws["!ref"]);
    for (let linha = alcance.s.r + 1; linha <= alcance.e.r; linha++) {
      const celula = ws[XLSX.utils.encode_cell({ r: linha, c: 1 })];
      if (celula && celula.t === "n") celula.z = FORMATO_MOEDA_PLANILHA;
    }
    ws["!cols"] = [{ wch: 44 }, { wch: 18 }, { wch: 14 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pagamentos");
    XLSX.writeFile(wb, `pagamentos-${data}.xlsx`);
  }

  /**
   * Saldo de cada conta para esta programação, pela fonte única de verdade:
   * Saldo Real da conta, menos o que outras programações do dia reservaram,
   * mais o que esta programação já debitou (o débito próprio já saiu do Saldo
   * Real, então volta aqui para que "Saldo disponível" e "Resta" não mudem
   * quando um pagamento desta programação é efetivado).
   */
  const contasComSaldoDisponivelHoje = React.useMemo(() => {
    return montarSaldosDasContas(contasDaSecretaria, {
      reservas: reservaPorConta,
      programacaoAtualId,
    }).map((c) => ({
      ...c,
      reservadoOutras: c.valorReservado,
      debitadoNestaProgramacao: c.debitadoNaProgramacaoAtual,
      saldoHoje: c.saldoDisponivel,
    }));
  }, [contasDaSecretaria, reservaPorConta, programacaoAtualId]);

  // As contas ficam na ordem em que foram escolhidas.
  const contasSelecionadasComSaldo = React.useMemo(() => {
    const posicao = new Map(contasDaProgramacao.map((c, i) => [String(c.conta_id), i]));
    return contasComSaldoDisponivelHoje
      .filter((c) => contasSelecionadas.has(c.id))
      .sort(
        (a, b) =>
          (posicao.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER) -
          (posicao.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER)
      );
  }, [contasComSaldoDisponivelHoje, contasSelecionadas, contasDaProgramacao]);

  const contaPagamento = React.useMemo(() => contasComSaldoDisponivelHoje.find((c) => String(c.id) === String(contaPagamentoId)), [contasComSaldoDisponivelHoje, contaPagamentoId]);

  // O pagamento sai integralmente desta única conta.
  const saldoDisponivel = React.useMemo(() => {
    return contaPagamento?.saldoHoje ?? 0;
  }, [contaPagamento]);

  const totalProgramado = React.useMemo(() => {
    return somar(pagamentos.map((p) => p.valor_a_pagar));
  }, [pagamentos]);

  // Soma das transferências ainda não confirmadas.
  const somaDoRateio = React.useMemo(() => {
    return somar(contasDaProgramacao.map((c) => rateioLocal[c.conta_id] ?? 0));
  }, [contasDaProgramacao, rateioLocal]);
  const conferenciaTransferencias = calcularConferenciaTransferencias({ saldoDestino: saldoDisponivel, transferencias: contasDaProgramacao.map((c) => ({ valor: rateioLocal[c.conta_id] ?? 0 })), totalPagamentos: totalProgramado });
  const saldoRestante = conferenciaTransferencias.restaAposPagamentos;
  const saldoInsuficiente = totalProgramado - saldoDisponivel > TOLERANCIA;

  const temRateioNaoSalvo = React.useMemo(() => {
    return contasDaProgramacao.some(
      (c) => emCentavos(rateioLocal[c.conta_id]) !== emCentavos(rateioSalvo[c.conta_id])
    );
  }, [contasDaProgramacao, rateioLocal, rateioSalvo]);


  const bancosDisponiveis = React.useMemo(
    () => [...new Set(contasComSaldoDisponivelHoje.map((conta) => conta.banco).filter(Boolean))].sort(),
    [contasComSaldoDisponivelHoje],
  );
  const secretariasDisponiveis = React.useMemo(
    () => [...new Set(contasComSaldoDisponivelHoje.map((conta) => conta.secretaria).filter(Boolean))].sort(),
    [contasComSaldoDisponivelHoje],
  );

  const contasPagamentoFiltradas = React.useMemo(() => contasComSaldoDisponivelHoje.filter((conta) => {
    const termo = buscaContaPagamento.trim().toLocaleLowerCase("pt-BR");
    return (!termo || textoConta(conta).includes(termo)) && (!filtroBancoPagamento || conta.banco === filtroBancoPagamento);
  }), [contasComSaldoDisponivelHoje, buscaContaPagamento, filtroBancoPagamento]);

  const contasFiltradas = React.useMemo(() => contasComSaldoDisponivelHoje.filter((conta) => {
    const termo = buscaConta.trim().toLocaleLowerCase("pt-BR");
    return String(conta.id) !== String(contaPagamentoId)
      && (!termo || textoConta(conta).includes(termo))
      && (!filtroBancoConta || conta.banco === filtroBancoConta)
      && (!filtroSecretariaConta || conta.secretaria === filtroSecretariaConta);
  }), [contasComSaldoDisponivelHoje, buscaConta, filtroBancoConta, filtroSecretariaConta, contaPagamentoId]);

  const totalSelecionado = somar(contasSelecionadasComSaldo.map((conta) => conta.saldoHoje));

  const todosValoresEmAberto = React.useMemo(() => {
    const fornecedor = fornecedoresDaSecretaria.find((f) => String(f.id) === String(fornecedorEscolhido));
    return fornecedor?.valores ?? [];
  }, [fornecedoresDaSecretaria, fornecedorEscolhido]);

  // Chips da barra de filtros: só leitura do que já está escolhido na tela.
  // Secretaria e data sempre têm valor, então os chips informam sem remover.
  const chipsContexto = [];
  const nomeSecretariaAtual = secretarias.find((s) => String(s.id) === String(secretariaId))?.nome;
  if (nomeSecretariaAtual) {
    chipsContexto.push({ chave: "secretaria", rotulo: `Secretaria: ${nomeSecretariaAtual}` });
  }
  if (data) {
    chipsContexto.push({
      chave: "data",
      rotulo: `Data: ${new Date(data + "T00:00:00").toLocaleDateString("pt-BR")}`,
    });
  }
  return (
    <Layout>
      <div className="px-8 py-7 print:px-0 print:py-0">
        <div className="flex items-start justify-between mb-6 print:mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-[#0F2A44]">Pagamentos Diários</h1>
            <p className="text-sm text-[#0F2A44]/60 mt-0.5 print:hidden">
              {fechado ? "Programação fechada -- somente leitura." : "Selecione ou crie uma programação para o dia"}
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
          </div>
        </div>

        {/* Secretaria e data escolhem a programação da tela. Ficam recolhidos ao
            abrir a página e continuam à vista nos chips da barra. */}
        <PainelFiltros
          className="mb-6"
          chips={chipsContexto}
        >
          <div className="flex flex-col sm:flex-row sm:items-end gap-3 pt-3">
            <label className="block">
              <span className="text-xs font-medium text-[#0F2A44]/70">Secretaria</span>
              <select
                value={secretariaId}
                onChange={(e) => { setSecretariaId(e.target.value); setProgramacaoAtualId(null); }}
                className="block w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm bg-white"
              >
                {secretarias.map((s) => (
                  <option key={s.id} value={s.id}>{s.nome}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-[#0F2A44]/70">Data</span>
              <input
                type="date"
                value={data}
                onChange={(e) => { setData(e.target.value); setProgramacaoAtualId(null); }}
                className="block w-full mt-1 px-3 py-2 rounded-lg border border-black/10 text-sm bg-white"
              />
            </label>
          </div>
        </PainelFiltros>

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
                <div className="flex items-center gap-2">
                  <button
                    onClick={abrirCopiarProgramacao}
                    className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]"
                  >
                    {mostrarCopiar ? <X size={14} /> : <Copy size={14} />}
                    Copiar programação anterior
                  </button>
                  <button
                    onClick={() => { setMostrarNovaProgramacao((v) => !v); setMostrarCopiar(false); }}
                    className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[#0F2A44] text-white"
                  >
                    {mostrarNovaProgramacao ? <X size={14} /> : <Plus size={14} />}
                    Nova programação
                  </button>
                </div>
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

              {mostrarCopiar && (
                <div className="flex gap-2 mb-3">
                  <select
                    value={programacaoParaCopiarId}
                    onChange={(e) => setProgramacaoParaCopiarId(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg border border-black/10 text-sm"
                  >
                    <option value="">Selecione a programação a copiar...</option>
                    {programacoesParaCopiar.map((p) => (
                      <option key={p.id} value={p.id}>
                        {new Date(p.data_programacao + "T00:00:00").toLocaleDateString("pt-BR")} -- {p.nome_programacao || "Sem nome"}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={copiarProgramacao}
                    disabled={salvando}
                    className="text-sm px-4 py-2 rounded-lg bg-[#0F2A44] text-white disabled:opacity-50"
                  >
                    {salvando ? "Copiando..." : `Copiar para ${new Date(data + "T00:00:00").toLocaleDateString("pt-BR")}`}
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
                        {p.fechado && <Lock size={11} />}
                        {p.nome_programacao || "Sem nome"}
                      </button>
                      {podeExcluir && (
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
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {programacaoAtualId && (
              <>
                <div className="flex items-center justify-between mb-3 print:hidden">
                  <div />
                  {fechado ? (
                    <button
                      onClick={reabrirMovimento}
                      disabled={salvando}
                      className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]"
                    >
                      <Unlock size={13} /> Reabrir movimento
                    </button>
                  ) : (
                    <button
                      onClick={fecharMovimento}
                      disabled={salvando}
                      className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[#16A34A] text-white"
                    >
                      <Lock size={13} /> Fechar Movimento do Dia
                    </button>
                  )}
                </div>

                {fechado && (
                  <div className="bg-[#EAFBF0] border border-[#16A34A]/20 text-[#16A34A] text-sm rounded-lg px-4 py-3 mb-5 print:hidden flex items-center gap-2">
                    <Lock size={14} /> Este movimento está fechado. Reabra para fazer alterações.
                  </div>
                )}

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

                <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-6 print:break-inside-avoid space-y-5">
                  <div>
                    <h2 className="text-sm font-semibold text-[#0F2A44]">1. Conta de pagamento</h2>
                    <p className="mt-1 text-xs text-[#0F2A44]/50">Todos os pagamentos desta programação saem integralmente de uma única conta.</p>
                    {!contaPagamentoId && (
                      <p className="mt-3 rounded-lg border border-[#EA9A1E]/25 bg-[#FFF8EA] px-3 py-2 text-xs text-[#8A5B00]">
                        Escolha uma conta de pagamento para esta programação.
                      </p>
                    )}
                    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
                      <label className="relative">
                        <Search size={14} className="absolute left-3 top-2.5 text-[#0F2A44]/40" />
                        <input value={buscaContaPagamento} onChange={(e) => setBuscaContaPagamento(e.target.value)} placeholder="Buscar conta de pagamento" className="w-full rounded-lg border border-black/10 py-2 pl-9 pr-3 text-sm" />
                      </label>
                      <select value={filtroBancoPagamento} onChange={(e) => setFiltroBancoPagamento(e.target.value)} className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm">
                        <option value="">Todos os bancos</option>
                        {bancosDisponiveis.map((banco) => <option key={banco}>{banco}</option>)}
                      </select>
                    </div>
                    <div className="mt-3 max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-black/10 bg-white divide-y divide-black/5" style={{ WebkitOverflowScrolling: "touch" }}>
                      {contasPagamentoFiltradas.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-[#0F2A44]/45">Nenhuma conta encontrada.</div>
                      ) : contasPagamentoFiltradas.map((conta) => (
                        <LinhaContaSelecao
                          key={conta.id}
                          conta={conta}
                          tipo="radio"
                          selecionada={String(conta.id) === String(contaPagamentoId)}
                          desabilitada={fechado}
                          onChange={() => definirContaPagamento(conta.id).catch((falha) => setErro(mensagemAmigavel(falha, "Não foi possível definir a conta de pagamento.")))}
                        />
                      ))}
                    </div>
                    {contaPagamentoId && <div className={`mt-2 text-xs ${saldoInsuficiente ? "text-[#A16207]" : "text-[#16803C]"}`}>{saldoInsuficiente ? `Falta transferir ${formatBRL(Math.max(0, totalProgramado - saldoDisponivel))}` : "✓ Saldo suficiente"}</div>}
                  </div>

                  {saldoInsuficiente && !fechado && (
                    <div>
                      <div className="flex flex-wrap items-end justify-between gap-3">
                        <div>
                          <h2 className="text-sm font-semibold text-[#0F2A44]">2. Contas de origem</h2>
                          <p className="mt-1 text-xs text-[#0F2A44]/50">Selecionar conta não movimenta dinheiro.</p>
                        </div>
                        <button type="button" onClick={selecionarTodasContas} className="rounded-lg border border-black/10 px-3 py-2 text-xs hover:bg-black/[0.03]">Selecionar todas</button>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_13rem_13rem]">
                        <label className="relative">
                          <Search size={14} className="absolute left-3 top-2.5 text-[#0F2A44]/40" />
                          <input value={buscaConta} onChange={(e) => setBuscaConta(e.target.value)} placeholder="Buscar por nome, banco ou conta" className="w-full rounded-lg border border-black/10 py-2 pl-9 pr-3 text-sm" />
                        </label>
                        <select value={filtroBancoConta} onChange={(e) => setFiltroBancoConta(e.target.value)} className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm">
                          <option value="">Todos os bancos</option>
                          {bancosDisponiveis.map((banco) => <option key={banco}>{banco}</option>)}
                        </select>
                        <select value={filtroSecretariaConta} onChange={(e) => setFiltroSecretariaConta(e.target.value)} className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm">
                          <option value="">Todas as secretarias</option>
                          {secretariasDisponiveis.map((secretaria) => <option key={secretaria}>{secretaria}</option>)}
                        </select>
                      </div>
                      <div className="mt-3 max-h-80 overflow-y-auto overscroll-contain rounded-xl border border-black/10 bg-white divide-y divide-black/5" style={{ WebkitOverflowScrolling: "touch" }}>
                        {contasFiltradas.length === 0 ? (
                          <div className="px-4 py-8 text-center text-sm text-[#0F2A44]/45">Nenhuma conta disponível com estes filtros.</div>
                        ) : contasFiltradas.map((conta) => (
                          <LinhaContaSelecao
                            key={conta.id}
                            conta={conta}
                            tipo="checkbox"
                            selecionada={contasSelecionadas.has(conta.id)}
                            desabilitada={false}
                            onChange={() => toggleConta(conta.id)}
                          />
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <strong className="mr-1 text-xs text-[#0F2A44]">{contasSelecionadas.size} {contasSelecionadas.size === 1 ? "conta selecionada" : "contas selecionadas"}</strong>
                        {contasSelecionadasComSaldo.map((conta) => (
                          <button type="button" key={conta.id} onClick={() => toggleConta(conta.id)} className="rounded-full bg-[#F0F3F5] px-3 py-1 text-xs text-[#0F2A44] hover:bg-[#E3E9EC]">
                            {conta.numero_conta || conta.nome_conta} ×
                          </button>
                        ))}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-[#F5F7F8] p-3 text-xs">
                        <div><span className="text-[#0F2A44]/50">Contas selecionadas</span><strong className="block text-base text-[#0F2A44]">{contasSelecionadas.size}</strong></div>
                        <div><span className="text-[#0F2A44]/50">Total disponível selecionado</span><strong className="block text-base text-[#0F2A44]">{formatBRL(totalSelecionado)}</strong></div>
                      </div>
                    </div>
                  )}

                  {contasSelecionadasComSaldo.length > 0 && !fechado && <div><h2 className="text-sm font-semibold text-[#0F2A44]">3. Valores a transferir</h2><div className="mt-2 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-[11px] uppercase text-[#0F2A44]/45"><th className="py-2">Conta de origem</th><th className="py-2 text-right">Saldo disponível</th><th className="py-2 text-right">Valor a transferir</th></tr></thead><tbody>{contasSelecionadasComSaldo.map((conta)=><tr key={conta.id} className="border-b border-black/5"><td className="py-2">{conta.banco} · {conta.numero_conta || conta.nome_conta}</td><td className="py-2 text-right font-semibold tabular-nums">{formatBRL(conta.saldoHoje)}</td><td className="py-2 text-right"><CampoMoeda valor={rateioLocal[conta.id] ?? 0} onValorChange={(numero)=>editarRateioLocal(conta.id, Math.min(numero, conta.saldoHoje))} className="w-40 rounded border border-black/10 px-2 py-1 text-right text-sm"/></td></tr>)}</tbody></table></div></div>}

                  {somaDoRateio > 0 && <div className="rounded-xl border border-[#0F2A44]/10 bg-[#F8FAFB] p-4"><h2 className="flex items-center gap-2 text-sm font-semibold text-[#0F2A44]"><ArrowRightLeft size={15}/> 4. Conferência antes da confirmação</h2><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 text-xs"><div>Total a transferir<strong className="block text-base">{formatBRL(conferenciaTransferencias.totalTransferir)}</strong></div><div>Saldo atual destino<strong className="block text-base">{formatBRL(saldoDisponivel)}</strong></div><div>Saldo após transferências<strong className="block text-base">{formatBRL(conferenciaTransferencias.saldoAposTransferencias)}</strong></div><div>Total dos pagamentos<strong className="block text-base">{formatBRL(totalProgramado)}</strong></div><div>Resta após pagamentos<strong className={`block text-base ${conferenciaTransferencias.restaAposPagamentos < 0 ? "text-red-600" : "text-[#16803C]"}`}>{formatBRL(conferenciaTransferencias.restaAposPagamentos)}</strong></div></div><div className="mt-3 flex gap-2"><button type="button" onClick={salvarRateioNaTela} disabled={!temRateioNaoSalvo || salvandoRateio} className="rounded-lg border px-3 py-2 text-xs disabled:opacity-40">Salvar valores</button><button type="button" onClick={confirmarTransferenciasNaTela} disabled={salvandoRateio || conferenciaTransferencias.restaAposPagamentos < 0 || !permissoesEspeciais.executar_transferencia} className="rounded-lg bg-[#0F2A44] px-4 py-2 text-xs text-white disabled:opacity-40">{salvandoRateio ? "Confirmando..." : "Confirmar transferências"}</button></div><p className="mt-2 text-[11px] text-[#0F2A44]/50">Somente confirmar movimenta os saldos. A transferência não é registrada como despesa.</p></div>}

                  {transferenciasRealizadas.length > 0 && <div><h2 className="text-sm font-semibold text-[#0F2A44]">Histórico de transferências</h2><div className="mt-2 divide-y divide-black/5 rounded-lg border border-black/5">{transferenciasRealizadas.map((transferencia)=><div key={transferencia.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs"><div><strong className="text-[#0F2A44]">{nomeDaConta(transferencia.conta_origem_id)} → {nomeDaConta(transferencia.conta_destino_id)}</strong><div className="mt-0.5 text-[#0F2A44]/50">{new Date(transferencia.criada_em).toLocaleString("pt-BR")} · ID {transferencia.id}</div></div><div className="flex items-center gap-3"><strong className="text-sm tabular-nums">{formatBRL(transferencia.valor)}</strong>{transferencia.estornada_em || transferencia.transferencia_original_id ? <span className="rounded bg-[#FFF6E5] px-2 py-1 text-[#8A5B00]">Estorno registrado</span> : permissoesEspeciais.estornar_transferencia && <button type="button" onClick={()=>estornarTransferenciaNaTela(transferencia)} className="rounded border border-red-200 px-2 py-1 text-red-600">Estornar</button>}</div></div>)}</div></div>}
                </div>

                {saldoInsuficiente && contaPagamentoId && (
                  <div className="bg-[#FFF1F1] border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-6 print:hidden">
                    <div className="font-semibold mb-1">Saldo insuficiente na conta de pagamento</div>
                    <div className="grid grid-cols-3 gap-3 text-xs tabular-nums">
                      <div>
                        <div className="opacity-70">Saldo disponível</div>
                        <div className="font-semibold">{formatBRL(saldoDisponivel)}</div>
                      </div>
                      <div>
                        <div className="opacity-70">Valor programado</div>
                        <div className="font-semibold">{formatBRL(totalProgramado)}</div>
                      </div>
                      <div>
                        <div className="opacity-70">Diferença</div>
                        <div className="font-semibold">{formatBRL(totalProgramado - saldoDisponivel)}</div>
                      </div>
                    </div>
                    <div className="text-xs mt-2 opacity-80">
                      Nenhuma conta é debitada enquanto o valor programado for maior que o saldo disponível.
                    </div>
                  </div>
                )}
                {!fechado && (
                  <div className="flex items-center gap-2 mb-4 print:hidden">
                    <button
                      onClick={abrirAddCadastrado}
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
                )}

                {mostrarAddCadastrado && !fechado && (
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
                        {todosValoresEmAberto.length === 0 && fornecedorEscolhido && (
                          <option value="" disabled>Este fornecedor não tem valores em aberto</option>
                        )}
                        {todosValoresEmAberto.map((v) => (
                          <option key={v.id} value={v.id}>
                            NF {v.numero_nota_fiscal || "--"} -- {formatBRL(v.valor - (v.valor_pago ?? 0))}
                          </option>
                        ))}
                      </select>
                      {fornecedorEscolhido && (
                        <label className="col-span-2 rounded-lg border border-black/10 p-3 text-xs text-[#0F2A44]/70">
                          <span className="mb-2 block font-medium text-[#0F2A44]">Dados cadastrados para conferência</span>
                          <select value={formaPagamentoId} onChange={(e) => setFormaPagamentoId(e.target.value)} className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm">
                            <option value="">Não vincular forma de pagamento</option>
                            {formasPagamentoFornecedor.map((forma) => <option key={forma.id} value={forma.id}>{resumirFormaPagamento(forma)}</option>)}
                          </select>
                          <span className="mt-2 flex items-center gap-2"><input type="checkbox" checked={Boolean(formaPagamentoId)} onChange={(e) => setFormaPagamentoId(e.target.checked ? (formasPagamentoFornecedor.find((forma) => forma.isPrimary)?.id || formasPagamentoFornecedor[0]?.id || "") : "")}/> Usar estes dados para pagamento</span>
                        </label>
                      )}
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

                {mostrarAddAvulso && !fechado && (
                  <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-6 space-y-3 print:hidden">
                    <h3 className="text-sm font-semibold text-[#0F2A44]">Adicionar fornecedor não cadastrado</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="text" placeholder="Nome"
                        value={avulso.nome}
                        onChange={(e) => setAvulso({ ...avulso, nome: e.target.value })}
                        className="px-3 py-2 rounded-lg border border-black/10 text-sm"
                      />
                      <CampoMoeda
                        placeholder="Valor"
                        valor={avulso.valor}
                        onValorChange={(numero) => setAvulso({ ...avulso, valor: numero })}
                        className="px-3 py-2 rounded-lg border border-black/10 text-sm text-right tabular-nums"
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
                          {!fechado && <th className="px-5 py-2 font-medium text-right print:hidden">Ações</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {pagamentos.map((p) => {
                          const baixasDoPagamento = baixasPorPagamento[String(p.id)] ?? [];
                          const resumo = resumoBaixas(p.valor_a_pagar, baixasDoPagamento);
                          return (
                          <tr key={p.id} className="border-b border-black/5 align-top">
                            <td className="px-5 py-2.5">
                              {p.fornecedores?.razao_social ?? p.nome_avulso}
                              {!p.fornecedor_id && (
                                <span className="ml-1.5 text-[10px] uppercase text-[#EA9A1E] bg-[#FFF6E5] px-1.5 py-0.5 rounded print:hidden">
                                  não cadastrado
                                </span>
                              )}
                              {p.forma_pagamento_resumo && <div className="mt-1 text-[11px] text-[#0F2A44]/50">{p.forma_pagamento_resumo}</div>}
                              {baixasDoPagamento.length > 0 && <div className="mt-2 space-y-1 text-[11px] text-[#0F2A44]/55">{baixasDoPagamento.map((baixa)=><div key={baixa.id}>{new Date(`${baixa.data_pagamento}T00:00:00`).toLocaleDateString("pt-BR")} · {formatBRL(baixa.valor_pago)} · {baixa.contas_bancarias?.bancos?.nome ?? baixa.contas_bancarias?.nome_conta ?? "Conta"} · {baixa.usuarios?.nome_completo ?? "Usuário não identificado"} · {baixa.status === "estornada" ? "Estornada" : "Efetivada"}</div>)}</div>}
                            </td>
                            <td className="px-5 py-2.5 text-right">
                              {fechado ? (
                                formatBRL(p.valor_a_pagar)
                              ) : (
                                <CampoMoeda
                                  valor={p.valor_a_pagar}
                                  onValorChange={(numero) => editarValorLocal(p.id, numero)}
                                  className="w-36 px-2 py-1 rounded border border-black/10 text-sm text-right tabular-nums print:border-none print:w-auto"
                                />
                              )}
                            </td>
                            <td className="px-5 py-2.5 text-center">
                              <div className="space-y-1">
                                <span className={`inline-block rounded-md px-2 py-1 text-xs font-medium ${resumo.situacao === "pago" ? "bg-[#EAFBF0] text-[#16A34A]" : resumo.situacao === "parcialmente_pago" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-[#0F2A44]/60"}`}>
                                  {resumo.situacao === "pago" ? "Pago" : resumo.situacao === "parcialmente_pago" ? "Parcialmente pago" : "Em aberto"}
                                </span>
                                <div className="text-[10px] text-[#0F2A44]/45">Total {formatBRL(resumo.valorTotal)} · baixado {formatBRL(resumo.totalBaixado)} · aberto {formatBRL(resumo.saldoEmAberto)}</div>
                              {resumo.saldoEmAberto > 0 && permissoesEspeciais.registrar_baixa && p.fornecedor_id && (
                                <button
                                  onClick={() => setBaixaPendente(p)}
                                  title="Registra a saída real e permite pagamento parcial."
                                  className="text-xs font-medium text-[#0F2A44]/60 hover:text-[#0F2A44] border border-black/10 px-2 py-1 rounded-md disabled:opacity-40 disabled:hover:text-[#0F2A44]/60 print:hidden"
                                >
                                  Registrar baixa
                                </button>
                              )}
                              {!p.fornecedor_id && <div className="text-[10px] text-amber-700">Vincule um fornecedor cadastrado para registrar baixa.</div>}
                              </div>
                            </td>
                            {!fechado && (
                              <td className="px-5 py-2.5 text-right print:hidden">
                                {podeExcluir && (
                                  <button
                                    onClick={() => removerPagamento(p.id)}
                                    disabled={p.situacao === "pago"}
                                    title={
                                      p.situacao === "pago"
                                        ? "Pagamento já efetivado e debitado nas contas."
                                        : "Remover pagamento"
                                    }
                                    className="text-[#0F2A44]/30 hover:text-red-500 disabled:opacity-30 disabled:hover:text-[#0F2A44]/30"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        )})}
                      </tbody>
                      <tfoot>
                        <tr className="bg-[#0F2A44]/[0.03]">
                          <td className="px-5 py-3 text-sm font-semibold text-[#0F2A44]">TOTAL</td>
                          <td className="px-5 py-3 text-right text-sm font-semibold text-[#0F2A44]">
                            {formatBRL(totalProgramado)}
                          </td>
                          {!fechado && <td />}
                        </tr>
                        <tr>
                          <td className="px-5 py-3 text-sm font-semibold text-[#0F2A44]">RESTA</td>
                          <td
                            className="px-5 py-3 text-right text-sm font-semibold"
                            style={{ color: saldoRestante < 0 ? "#DC2626" : "#0F2A44" }}
                          >
                            {formatBRL(saldoRestante)}
                          </td>
                          {!fechado && <td />}
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

      {exclusaoPendente && (
        <ModalConfirmarExclusao
          registro={exclusaoPendente.registro}
          aviso={exclusaoPendente.aviso}
          exigirMotivo={exclusaoPendente.exigirMotivo}
          detalhes={exclusaoPendente.detalhes}
          onCancelar={() => setExclusaoPendente(null)}
          onConfirmar={confirmarExclusao}
        />
      )}
      {baixaPendente && (
        <ModalBaixaPagamento
          pagamento={baixaPendente}
          fornecedores={fornecedoresDaSecretaria}
          contas={contasDaSecretaria}
          contaSugeridaId={contaPagamentoId}
          baixas={baixasPorPagamento[String(baixaPendente.id)] ?? []}
          onFechar={() => setBaixaPendente(null)}
          onConcluida={async () => {
            await carregarContasEFornecedores(secretariaId);
            await carregarProgramacaoAtual();
            await carregarProgramacoesDoDia();
          }}
        />
      )}
    </Layout>
  );
}
