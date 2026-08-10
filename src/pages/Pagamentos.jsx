import React from "react";
import { Plus, X, Trash2, Check, ChevronRight, Pencil, Printer, FileText, FileSpreadsheet, Copy, Lock, Unlock, Scale } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabaseClient";
import Layout from "../components/Layout";
import CampoMoeda from "../components/CampoMoeda";
import { formatBRL, paraNumeroMoeda, FORMATO_MOEDA_PLANILHA } from "../lib/moeda";
import { mensagemAmigavel, erroAmigavel } from "../lib/erros";
import {
  TOLERANCIA,
  emCentavos,
  somar,
  rateioFecha,
  ratearAutomaticamente,
  textoSaldoInsuficiente,
  textoRateioDivergente,
  textoDoMotivo,
} from "../lib/rateioPagamentos";
import { montarSaldosDasContas } from "../lib/saldosContas";
import {
  buscarReservasPorConta,
  buscarSaldoRealPorConta,
  estruturaDeRateioAusente,
} from "../lib/saldosContasDados";

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

// Aviso usado quando o banco deste ambiente ainda não recebeu a estrutura de
// rateio (coluna valor_rateado, razão de movimentações e função de efetivação).
const AVISO_RATEIO_INDISPONIVEL =
  "O rateio entre contas ainda não está disponível neste ambiente. " +
  "Peça ao administrador para aplicar a atualização do banco de dados antes de efetivar pagamentos.";

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

  // Contas desta programação na ordem em que foram escolhidas, com o rateio
  // gravado no banco; `rateioLocal` é o que está na tela agora.
  const [contasDaProgramacao, setContasDaProgramacao] = React.useState([]);
  const [rateioLocal, setRateioLocal] = React.useState({});
  const [rateioSalvo, setRateioSalvo] = React.useState({});
  const [salvandoRateio, setSalvandoRateio] = React.useState(false);
  const [rateioIndisponivel, setRateioIndisponivel] = React.useState(false);
  const [efetivandoId, setEfetivandoId] = React.useState(null);

  // Por conta: quanto outras programações do dia reservaram e quanto esta
  // programação já debitou de verdade (Map montado pela fonte única de saldo).
  const [reservaPorConta, setReservaPorConta] = React.useState(new Map());

  const [mostrarAddCadastrado, setMostrarAddCadastrado] = React.useState(false);
  const [mostrarAddAvulso, setMostrarAddAvulso] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);

  const [fornecedorEscolhido, setFornecedorEscolhido] = React.useState("");
  const [valorEmAbertoEscolhido, setValorEmAbertoEscolhido] = React.useState("");
  const [avulso, setAvulso] = React.useState({ nome: "", descricao: "", valor: "" });

  const [mostrarCopiar, setMostrarCopiar] = React.useState(false);
  const [programacoesParaCopiar, setProgramacoesParaCopiar] = React.useState([]);
  const [programacaoParaCopiarId, setProgramacaoParaCopiarId] = React.useState("");

  const timersRef = React.useRef({});
  // Trava síncrona contra duplo clique em "Marcar como pago".
  const efetivandoRef = React.useRef(null);

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
      setContasDaProgramacao([]);
      setRateioLocal({});
      setRateioSalvo({});
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
      setErro(mensagemAmigavel(e, "Não foi possível carregar as secretarias."));
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

      // Saldo Real das contas pela fonte única (consulta paginada, um registro
      // por conta): o mesmo número que o Painel Principal e Saldos das Contas.
      const saldos = await buscarSaldoRealPorConta({ contaIds: (contas ?? []).map((c) => c.id) });

      const contasComSaldo = montarSaldosDasContas(
        (contas ?? []).map((c) => ({
          id: c.id,
          nome_conta: c.nome_conta,
          numero_conta: c.numero_conta,
          banco: c.bancos?.nome ?? "--",
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
        .select("conta_id, valor_rateado, ordem")
        .eq("programacao_id", programacaoAtualId);

      let linhasDeContas = pc;
      if (ePc) {
        if (!estruturaDeRateioAusente(ePc)) throw ePc;
        // Banco sem a estrutura de rateio: a tela ainda abre, só não rateia.
        setRateioIndisponivel(true);
        const { data: simples, error: eSimples } = await supabase
          .from("programacao_contas")
          .select("conta_id")
          .eq("programacao_id", programacaoAtualId);
        if (eSimples) throw eSimples;
        linhasDeContas = (simples ?? []).map((r) => ({ ...r, valor_rateado: 0, ordem: null }));
      }

      const ordenadas = [...(linhasDeContas ?? [])].sort(
        (a, b) =>
          (a.ordem ?? Number.MAX_SAFE_INTEGER) - (b.ordem ?? Number.MAX_SAFE_INTEGER) ||
          String(a.conta_id).localeCompare(String(b.conta_id))
      );
      setContasDaProgramacao(ordenadas);

      const rateio = {};
      for (const r of ordenadas) rateio[r.conta_id] = emCentavos(paraNumeroMoeda(r.valor_rateado));
      setRateioLocal(rateio);
      setRateioSalvo(rateio);

      const setContas = new Set(ordenadas.map((r) => r.conta_id));
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
      setErro(mensagemAmigavel(e, "Não foi possível abrir a programação selecionada."));
    }
  }

  async function fecharMovimento() {
    setErro(null);

    // Só fecha quando as contas, o rateio e o saldo estão coerentes.
    if (contasSelecionadas.size === 0) {
      setErro("Escolha as contas bancárias desta programação antes de fechar o movimento.");
      return;
    }
    if (saldoInsuficiente) {
      setErro(textoSaldoInsuficiente(saldoDisponivel, totalProgramado));
      return;
    }
    if (!rateioIndisponivel && !rateioConfere) {
      setErro(textoRateioDivergente(somaDoRateio, totalProgramado));
      return;
    }
    if (!confirm("Fechar o movimento deste dia? A programação ficará somente para leitura até ser reaberta.")) return;
    setSalvando(true);
    try {
      if (temRateioNaoSalvo) await salvarRateio();
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

  async function excluirProgramacao(progId) {
    if (!confirm("Excluir esta programação e todos os pagamentos lançados nela?")) return;
    setErro(null);
    try {
      // Pagamento já efetivado saiu do saldo da conta: apagar aqui deixaria o
      // débito sem origem, então a exclusão é barrada.
      const { data: pagos, error: ePagos } = await supabase
        .from("pagamentos")
        .select("id")
        .eq("programacao_id", progId)
        .eq("situacao", "pago")
        .limit(1);
      if (ePagos) throw ePagos;
      if (pagos && pagos.length > 0) {
        throw erroAmigavel(
          "Esta programação já tem pagamento efetivado e debitado em conta. Não é possível excluí-la."
        );
      }

      await supabase.from("pagamentos").delete().eq("programacao_id", progId);
      await supabase.from("programacao_contas").delete().eq("programacao_id", progId);
      const { error } = await supabase.from("programacoes_pagamento").delete().eq("id", progId);
      if (error) throw error;
      setProgramacaoAtualId(null);
      await carregarProgramacoesDoDia();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível excluir a programação."));
    }
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
        // O rateio não é copiado: a programação nova começa com tudo pendente,
        // e o valor de cada conta é definido (ou rateado) de novo.
        const novasContas = contasParaCopiar.map((c, i) => ({
          programacao_id: nova.id,
          conta_id: c.conta_id,
          ...(eContasOrigem ? {} : { ordem: c.ordem ?? i + 1, valor_rateado: 0 }),
        }));
        const { error: eInsContas } = await supabase.from("programacao_contas").insert(novasContas);
        if (eInsContas) throw eInsContas;
      }

      const { data: pagamentosOrigem, error: ePagOrigem } = await supabase
        .from("pagamentos")
        .select("fornecedor_id, valor_em_aberto_id, valor_a_pagar, nome_avulso, descricao")
        .eq("programacao_id", programacaoParaCopiarId);
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
          ...(rateioIndisponivel ? {} : { ordem: proximaOrdem, valor_rateado: 0 }),
        });
        if (error) throw error;
      }

      // Recarrega para manter contas, ordem e rateio em sincronia com o banco.
      await carregarProgramacaoAtual();
      await carregarProgramacoesDoDia();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível alterar as contas desta programação."));
    }
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
      });
      if (error) throw error;

      setFornecedorEscolhido("");
      setValorEmAbertoEscolhido("");
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

  async function removerPagamento(pagamentoId) {
    setErro(null);
    try {
      const pagamento = pagamentos.find((p) => p.id === pagamentoId);
      if (pagamento?.situacao === "pago") {
        throw erroAmigavel(
          "Este pagamento já foi efetivado e debitado nas contas. Não é possível removê-lo."
        );
      }
      const { error } = await supabase.from("pagamentos").delete().eq("id", pagamentoId);
      if (error) throw error;
      await carregarProgramacaoAtual();
      await carregarProgramacoesDoDia();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível remover o pagamento."));
    }
  }

  function editarRateioLocal(contaId, novoValor) {
    setRateioLocal((atual) => ({ ...atual, [contaId]: emCentavos(novoValor) }));
  }

  /** Grava no banco o rateio informado (uma linha de programacao_contas por conta). */
  async function persistirRateio(valores) {
    if (rateioIndisponivel) throw erroAmigavel(AVISO_RATEIO_INDISPONIVEL);

    const alteradas = Object.entries(valores).filter(
      ([contaId, valor]) => emCentavos(valor) !== emCentavos(rateioSalvo[contaId])
    );

    for (const [contaId, valor] of alteradas) {
      const { error } = await supabase
        .from("programacao_contas")
        .update({ valor_rateado: emCentavos(valor) })
        .eq("programacao_id", programacaoAtualId)
        .eq("conta_id", contaId);
      if (error) throw error;
    }

    setRateioSalvo((atual) => ({ ...atual, ...valores }));
    setContasDaProgramacao((atual) =>
      atual.map((c) =>
        c.conta_id in valores ? { ...c, valor_rateado: emCentavos(valores[c.conta_id]) } : c
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
      setErro(mensagemAmigavel(e, "Não foi possível salvar o rateio entre as contas."));
    } finally {
      setSalvandoRateio(false);
    }
  }

  /**
   * Rateio automático: usa as contas na ordem em que foram escolhidas e enche
   * uma até esgotar o saldo disponível antes de passar para a próxima.
   */
  async function ratearAutomaticamenteNaTela() {
    setSalvandoRateio(true);
    setErro(null);
    try {
      if (rateioIndisponivel) throw erroAmigavel(AVISO_RATEIO_INDISPONIVEL);
      if (contasSelecionadasComSaldo.length === 0) {
        throw erroAmigavel("Escolha as contas bancárias desta programação antes de ratear.");
      }

      const { rateio, faltante } = ratearAutomaticamente(
        contasSelecionadasComSaldo.map((c) => ({
          id: c.id,
          disponivel: c.saldoHoje,
          minimo: c.debitadoNestaProgramacao,
        })),
        totalProgramado
      );

      setRateioLocal((atual) => ({ ...atual, ...rateio }));
      await persistirRateio(rateio);

      if (faltante > 0) {
        throw erroAmigavel(textoSaldoInsuficiente(saldoDisponivel, totalProgramado));
      }
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível ratear automaticamente entre as contas."));
    } finally {
      setSalvandoRateio(false);
    }
  }

  /**
   * Efetivação do pagamento: valida rateio e saldo, debita de cada conta apenas
   * o valor rateado para ela e muda a situação -- tudo numa única transação no
   * banco. Um segundo clique não gera novo débito.
   */
  async function marcarPago(pagamento) {
    // Duplo clique: o pedido só sai uma vez (e o banco também é idempotente).
    if (pagamento.situacao === "pago" || efetivandoRef.current) return;
    efetivandoRef.current = pagamento.id;
    setErro(null);
    setEfetivandoId(pagamento.id);
    try {
      if (rateioIndisponivel) throw erroAmigavel(AVISO_RATEIO_INDISPONIVEL);
      if (contasSelecionadas.size === 0) {
        throw erroAmigavel("Escolha as contas bancárias desta programação antes de efetivar o pagamento.");
      }
      if (saldoInsuficiente) {
        throw erroAmigavel(textoSaldoInsuficiente(saldoDisponivel, totalProgramado));
      }
      if (temRateioNaoSalvo) await salvarRateio();
      if (!rateioConfere) {
        throw erroAmigavel(textoRateioDivergente(somaDoRateio, totalProgramado));
      }

      const { data: resultado, error } = await supabase.rpc("marcar_pagamento_pago", {
        p_pagamento_id: String(pagamento.id),
      });
      if (error) {
        throw estruturaDeRateioAusente(error) ? erroAmigavel(AVISO_RATEIO_INDISPONIVEL) : error;
      }
      if (resultado && resultado.ok === false) {
        throw erroAmigavel(textoDoMotivo(resultado, nomeDaConta(resultado.conta_id)));
      }

      await carregarContasEFornecedores(secretariaId);
      await carregarProgramacaoAtual();
      await carregarProgramacoesDoDia();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível marcar este pagamento como pago."));
    } finally {
      efetivandoRef.current = null;
      setEfetivandoId(null);
    }
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

    // Rateio: quanto sai de cada conta escolhida (a soma fecha com o total).
    contasSelecionadasComSaldo.forEach((c) => {
      linhas.push({
        Fornecedor: `RATEIO -- ${c.banco} · ${c.nome_conta}`,
        "Valor a pagar": emCentavos(rateioLocal[c.id] ?? 0),
        Situação: "",
      });
    });
    linhas.push({ Fornecedor: "SOMA DO RATEIO", "Valor a pagar": somaDoRateio, Situação: "" });

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

  // As contas ficam na ordem em que foram escolhidas (a mesma do rateio automático).
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

  // Item 1: o saldo disponível da programação é a SOMA dos saldos das contas escolhidas.
  const saldoDisponivel = React.useMemo(() => {
    return somar(contasSelecionadasComSaldo.map((c) => c.saldoHoje));
  }, [contasSelecionadasComSaldo]);

  const totalProgramado = React.useMemo(() => {
    return somar(pagamentos.map((p) => p.valor_a_pagar));
  }, [pagamentos]);

  // Item 6: resta = saldo disponível das contas desta programação - total dela.
  const saldoRestante = emCentavos(saldoDisponivel - totalProgramado);

  // Soma sobre todas as contas da programação (é essa soma que o banco valida).
  const somaDoRateio = React.useMemo(() => {
    return somar(contasDaProgramacao.map((c) => rateioLocal[c.conta_id] ?? 0));
  }, [contasDaProgramacao, rateioLocal]);

  const rateioConfere = rateioFecha(somaDoRateio, totalProgramado);
  const saldoInsuficiente = totalProgramado - saldoDisponivel > TOLERANCIA;

  const temRateioNaoSalvo = React.useMemo(() => {
    return contasDaProgramacao.some(
      (c) => emCentavos(rateioLocal[c.conta_id]) !== emCentavos(rateioSalvo[c.conta_id])
    );
  }, [contasDaProgramacao, rateioLocal, rateioSalvo]);

  const podeEfetivar =
    !rateioIndisponivel && contasSelecionadas.size > 0 && !saldoInsuficiente && rateioConfere;

  const todosValoresEmAberto = React.useMemo(() => {
    const fornecedor = fornecedoresDaSecretaria.find((f) => String(f.id) === String(fornecedorEscolhido));
    return fornecedor?.valores ?? [];
  }, [fornecedoresDaSecretaria, fornecedorEscolhido]);
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

                <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-6 print:break-inside-avoid">
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-sm font-semibold text-[#0F2A44]">Contas bancárias desta programação</h2>
                    {!fechado && (
                      !contasFinalizadas ? (
                        <button
                          onClick={() => setContasFinalizadas(true)}
                          disabled={contasSelecionadas.size === 0}
                          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[#0F2A44] text-white disabled:opacity-40 print:hidden"
                        >
                          <Check size={13} /> Finalizar escolha
                        </button>
                      ) : (
                        <div className="flex items-center gap-2 print:hidden">
                          <button
                            onClick={ratearAutomaticamenteNaTela}
                            disabled={salvandoRateio || rateioIndisponivel}
                            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44] disabled:opacity-40"
                          >
                            <Scale size={13} /> Ratear automaticamente
                          </button>
                          <button
                            onClick={salvarRateioNaTela}
                            disabled={salvandoRateio || rateioIndisponivel || !temRateioNaoSalvo}
                            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[#0F2A44] text-white disabled:opacity-40"
                          >
                            <Check size={13} /> {salvandoRateio ? "Salvando..." : "Salvar rateio"}
                          </button>
                          <button
                            onClick={() => setContasFinalizadas(false)}
                            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]"
                          >
                            <Pencil size={13} /> Editar contas
                          </button>
                        </div>
                      )
                    )}
                  </div>
                  <p className="text-xs text-[#0F2A44]/50 mb-3 print:hidden">
                    O saldo já considera o que outras programações de hoje reservaram nas mesmas contas.
                    Cada conta é debitada apenas pelo valor rateado para ela, e só quando o pagamento é marcado como pago.
                  </p>

                  {rateioIndisponivel && (
                    <div className="bg-[#FFF6E5] border border-[#EA9A1E]/30 text-[#8A5B00] text-xs rounded-lg px-3 py-2.5 mb-3 print:hidden">
                      {AVISO_RATEIO_INDISPONIVEL}
                    </div>
                  )}

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
                                  disabled={fechado}
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
                          <th className="py-2 font-medium text-right">Rateio (débito desta conta)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contasSelecionadasComSaldo.map((c) => (
                          <tr key={c.id} className="border-b border-black/5">
                            <td className="py-2">{c.banco}</td>
                            <td className="py-2 text-[#0F2A44]/70">{c.numero_conta || "--"}</td>
                            <td className="py-2">{c.nome_conta}</td>
                            <td className="py-2 text-right tabular-nums">{formatBRL(c.saldoHoje)}</td>
                            <td className="py-2 text-right">
                              {fechado || rateioIndisponivel ? (
                                <span className="tabular-nums">{formatBRL(rateioLocal[c.id] ?? 0)}</span>
                              ) : (
                                <CampoMoeda
                                  valor={rateioLocal[c.id] ?? 0}
                                  onValorChange={(numero) => editarRateioLocal(c.id, numero)}
                                  className="w-36 px-2 py-1 rounded border border-black/10 text-sm text-right tabular-nums print:border-none print:w-auto"
                                />
                              )}
                              {c.debitadoNestaProgramacao > 0 && (
                                <div className="text-[10px] text-[#16A34A] mt-0.5 print:hidden">
                                  já debitado: {formatBRL(c.debitadoNestaProgramacao)}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-[#0F2A44]/[0.03]">
                          <td colSpan={3} className="py-2.5 font-semibold text-[#0F2A44]">TOTAL SALDO</td>
                          <td className="py-2.5 text-right font-semibold text-[#0F2A44]">{formatBRL(saldoDisponivel)}</td>
                          <td
                            className="py-2.5 text-right font-semibold tabular-nums"
                            style={{ color: rateioConfere ? "#0F2A44" : "#DC2626" }}
                          >
                            {formatBRL(somaDoRateio)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  )}

                  {contasFinalizadas && !rateioIndisponivel && (
                    <div className="mt-3 text-xs print:hidden">
                      {rateioConfere ? (
                        <div className="flex items-center gap-1.5 text-[#16A34A]">
                          <Check size={13} />
                          Rateio conferido: a soma do rateio é igual ao total dos pagamentos desta programação.
                        </div>
                      ) : (
                        <div className="bg-[#FFF1F1] border border-red-200 text-red-700 rounded-lg px-3 py-2.5">
                          {textoRateioDivergente(somaDoRateio, totalProgramado)}
                          {temRateioNaoSalvo && " Salve o rateio para concluir."}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {saldoInsuficiente && contasSelecionadas.size > 0 && (
                  <div className="bg-[#FFF1F1] border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-6 print:hidden">
                    <div className="font-semibold mb-1">Saldo insuficiente nas contas selecionadas</div>
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
                              {p.situacao === "pago" ? (
                                <span className="text-xs font-medium text-[#16A34A] bg-[#EAFBF0] px-2 py-1 rounded-md">
                                  Pago
                                </span>
                              ) : fechado ? (
                                <span className="text-xs font-medium text-[#0F2A44]/50">Pendente</span>
                              ) : (
                                <button
                                  onClick={() => marcarPago(p)}
                                  disabled={!podeEfetivar || efetivandoId !== null}
                                  title={
                                    rateioIndisponivel
                                      ? AVISO_RATEIO_INDISPONIVEL
                                      : contasSelecionadas.size === 0
                                        ? "Escolha as contas bancárias desta programação."
                                        : saldoInsuficiente
                                          ? textoSaldoInsuficiente(saldoDisponivel, totalProgramado)
                                          : !rateioConfere
                                            ? textoRateioDivergente(somaDoRateio, totalProgramado)
                                            : "Debita de cada conta o valor rateado para ela."
                                  }
                                  className="text-xs font-medium text-[#0F2A44]/60 hover:text-[#0F2A44] border border-black/10 px-2 py-1 rounded-md disabled:opacity-40 disabled:hover:text-[#0F2A44]/60 print:hidden"
                                >
                                  {efetivandoId === p.id ? "Efetivando..." : "Marcar como pago"}
                                </button>
                              )}
                            </td>
                            {!fechado && (
                              <td className="px-5 py-2.5 text-right print:hidden">
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
                              </td>
                            )}
                          </tr>
                        ))}
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
    </Layout>
  );
}
