import React from "react";
import { AlertTriangle, Check, FileDown, FileSpreadsheet, Plus, Printer, Search, Trash2, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import Layout from "../components/Layout";
import CampoMoeda from "../components/CampoMoeda";
import { formatBRL } from "../lib/moeda";
import { mensagemAmigavel } from "../lib/erros";
import { carregarSaldosDasContas } from "../lib/saldosContasDados";
import { usePermissaoModulo } from "../lib/permissoes";
import { agoraBR, exportarExcelProgramacao, gerarPdfProgramacao, imprimirProgramacao } from "../lib/programacaoDocumento";
import { alternarSelecao, calcularRestante, definirValorProgramado, ordenarFornecedoresPorAberto, selecionarTodosVisiveis, somarContasSelecionadas, somarPagamentos, valorPlanejamento } from "../lib/planejamentoPagamentos";
import { FUNCOES_FASE_1, classificarFalhaFase1, detalheDoBanco, verificarEstruturaFase1 } from "../lib/estruturaPagamentosFase1";
import { verificarEstruturaFase2 } from "../lib/estruturaPagamentosFase2";
import { STATUS_APROVADA, aplicarContaEmPagamentos, emExecucao, emRevisaoPosAnalise, impedimentosParaAprovar, podeRevisarProposta, resumoAprovacao, statusLabelExecucao } from "../lib/execucaoProgramacao";
import { aprovarProgramacao, carregarContasParaTransferencia, carregarPermissoesFase2, carregarTransferenciasDaProgramacao, definirContaDePagamentos, estruturaFase2Ausente } from "../lib/execucaoProgramacaoDados";
import ModalAprovacaoProgramacao from "../components/pagamentos/ModalAprovacaoProgramacao";
import ModalEstornoTransferencia from "../components/pagamentos/ModalEstornoTransferencia";
import ModalTransferenciaEntreContas from "../components/pagamentos/ModalTransferenciaEntreContas";
import PainelExecucaoProgramacao from "../components/pagamentos/PainelExecucaoProgramacao";

const hojeISO = () => {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
};
const numero = (valor) => valorPlanejamento(valor);
const dataBR = (valor) => new Date(`${valor}T00:00:00`).toLocaleDateString("pt-BR");
const nomeAutomatico = (data) => `PROGRAMAÇÃO DIÁRIA — ${dataBR(data)}`;
const textoConta = (conta) => `${conta.banco} ${conta.numero_conta} ${conta.nome_conta}`.toLocaleLowerCase("pt-BR");
const MIGRATION_FASE_1 = "supabase/migrations/20260827000000_consolidar_fluxo_pagamentos_diarios.sql";
const MIGRATION_REPARO_FASE_1 = "supabase/migrations/20260827130000_reaplicar_estrutura_pagamentos_fase_1.sql";
const MIGRATION_FASE_2 = "supabase/migrations/20260828140000_execucao_financeira_fase_2.sql";
const MIGRATION_CORRECAO_APROVACAO = "supabase/migrations/20260828170000_corrigir_aprovacao_programacao.sql";
const MIGRATION_CORRECAO_FORNECEDORES = "supabase/migrations/20260828190000_corrigir_gravacao_fornecedores_programacao.sql";
const MIGRATION_PADRONIZACAO_USUARIO = "supabase/migrations/20260828210000_padronizar_usuario_em_vinculos_pagamentos.sql";

// Ausência de id: nulo, indefinido, texto vazio ou zero. Nenhum deles é um id
// de registro, e nenhum deles pode chegar ao banco como se fosse -- em coluna
// com vínculo o banco recusaria a gravação inteira.
function vazio(valor) {
  return valor == null || valor === "" || Number(valor) === 0;
}

function idInteiro(valor, campo) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) {
    const erro = new Error(`${campo} inválido.`);
    erro.amigavel = true;
    throw erro;
  }
  return id;
}

// Todo erro da Fase 1 vai inteiro para o console: o objeto original do Supabase
// (code, message, details, hint) mais o contexto da chamada, a classificação que
// a tela usou para escolher a mensagem e os campos estruturados que o banco
// mandou no DETAIL (etapa, constraint, tabela, coluna). Nenhuma falha fica só
// como texto, e nenhuma chave estrangeira fica sem nome.
function registrarErroFase1(operacao, falha, contexto = {}) {
  if (typeof console === "undefined") return;
  console.error(`[Pagamentos Fase 1] ${operacao}`, {
    ...contexto,
    code: falha?.code,
    message: falha?.message,
    details: falha?.details,
    hint: falha?.hint,
    status: falha?.status,
    banco: detalheDoBanco(falha),
    classificacao: classificarFalhaFase1(falha),
    erroOriginal: falha,
  });
}

function listaLegivel(itens) {
  return itens.join(", ");
}

function mensagemEstruturaAusente(objetos) {
  const detalhe = objetos.length ? ` Falta no banco: ${listaLegivel(objetos)}.` : "";
  return `A estrutura da Fase 1 não está disponível no banco conectado a esta tela.${detalhe} Execute ${MIGRATION_FASE_1} e ${MIGRATION_REPARO_FASE_1} no mesmo projeto Supabase usado pela aplicação e recarregue a página. O erro completo do banco está no console (F12).`;
}

// A tela só afirma "falta estrutura" quando o próprio banco disse que o objeto
// não existe (42P01/42703/42883/PGRST200/PGRST202/PGRST204/PGRST205). Permissão
// e sessão têm mensagem própria; o resto continua com a mensagem do contexto.
function mensagemFalhaFase1(falha, mensagemPadrao) {
  const classificacao = classificarFalhaFase1(falha);

  if (classificacao.tipo === "estrutura") {
    const objeto = classificacao.objeto;
    if (classificacao.alvo === "funcao") {
      const esperada = FUNCOES_FASE_1.find((funcao) => String(objeto ?? "").includes(funcao.nome));
      const assinatura = esperada ? ` A tela chama ${esperada.nome}${esperada.assinatura}.` : "";
      return `${mensagemEstruturaAusente(objeto ? [objeto] : [])} A função pode existir com outra assinatura de tipos.${assinatura}`;
    }
    return mensagemEstruturaAusente(objeto ? [objeto] : []);
  }

  if (classificacao.tipo === "permissao") {
    return "Seu usuário não tem permissão para esta operação nos Pagamentos Diários (ou a sessão expirou). Isto não é falta de estrutura no banco: o erro completo está no console (F12).";
  }

  // 22P02 vindo daqui não é valor mal digitado: a tela só envia número, e o
  // aviso antigo ("formato inválido") mandava conferir valores que estavam
  // certos. O que existe por trás é comparação entre tipos incompatíveis dentro
  // da função do banco -- texto contra enum, texto contra boolean -- e a
  // correção é rodar a migration que refaz essas funções.
  if (String(falha?.code ?? "") === "22P02") {
    return `O banco recusou a operação por incompatibilidade de tipo entre um valor e a coluna correspondente. Não é o valor digitado na tela. Execute ${MIGRATION_CORRECAO_APROVACAO} no SQL Editor do mesmo projeto Supabase usado pela aplicação e tente novamente. O erro completo do banco está no console (F12).`;
  }

  // 23503 é recusa de vínculo entre registros. A mensagem geral do sistema
  // ("este registro está ligado a outros lançamentos") descreve o caso oposto --
  // aqui o problema é um id que NÃO existe no destino, não um registro em uso.
  // Depois da migration de correção o próprio banco explica qual vínculo caiu;
  // enquanto ela não roda, a tela diz o que executar.
  if (String(falha?.code ?? "") === "23503") {
    const banco = detalheDoBanco(falha);
    const vinculo = banco.constraint || banco.coluna ? " O vínculo exato está no console (F12)." : "";
    return `O banco recusou um vínculo entre registros: algum item escolhido aponta para um cadastro que não existe mais. Recarregue a página, refaça a escolha dos fornecedores e das contas e salve. Se continuar, execute ${MIGRATION_CORRECAO_FORNECEDORES} e ${MIGRATION_PADRONIZACAO_USUARIO} no SQL Editor do mesmo projeto Supabase usado pela aplicação.${vinculo}`;
  }

  return mensagemAmigavel(falha, mensagemPadrao);
}

// A execução financeira tem migration própria, e ela roda à mão no SQL Editor.
// Enquanto não rodar, a tela não pode quebrar: a Fase 1 inteira continua de pé e
// só a aprovação, a execução e a transferência ficam indisponíveis, com o aviso
// dizendo qual arquivo executar.
function mensagemFalhaFase2(falha, mensagemPadrao) {
  if (estruturaFase2Ausente(falha)) {
    return `A estrutura da Fase 2 (execução financeira) não está no banco conectado a esta tela. Execute ${MIGRATION_FASE_2} no SQL Editor do mesmo projeto Supabase usado pela aplicação e recarregue a página. O erro completo do banco está no console (F12).`;
  }
  return mensagemFalhaFase1(falha, mensagemPadrao);
}

function registrarErroFase2(operacao, falha, contexto = {}) {
  if (typeof console === "undefined") return;
  console.error(`[Pagamentos Fase 2] ${operacao}`, {
    ...contexto,
    code: falha?.code,
    message: falha?.message,
    details: falha?.details,
    hint: falha?.hint,
    status: falha?.status,
    banco: detalheDoBanco(falha),
    classificacao: classificarFalhaFase1(falha),
    erroOriginal: falha,
  });
}

function nomePagamento(pagamento) {
  return pagamento.fornecedores?.razao_social || pagamento.nome_avulso || "Fornecedor avulso";
}

function statusLabel(status, fechado = false) {
  // "APROVADA / AGUARDANDO EXECUÇÃO" entra aqui: aprovado não é pago, e o
  // rótulo diz isso ao usuário sem depender de nenhuma outra tela.
  return statusLabelExecucao(status, fechado);
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
  const [estrutura, setEstrutura] = React.useState(null);
  // Recolhimento dos blocos: organização visual da tela, nada mais. Confirmar
  // não grava, não movimenta saldo e não muda nenhum cálculo -- apenas esconde
  // a lista completa para sobrar na tela (e no papel) o que foi escolhido.
  const [contasConfirmadas, setContasConfirmadas] = React.useState(false);
  const [fornecedoresConfirmados, setFornecedoresConfirmados] = React.useState(false);
  // Etapa de execução (Fase 2). Nada aqui movimenta saldo, com uma única
  // exceção: a transferência entre contas confirmada.
  const [estruturaFase2, setEstruturaFase2] = React.useState(null);
  const [permissoesFase2, setPermissoesFase2] = React.useState(null);
  const [transferencias, setTransferencias] = React.useState([]);
  const [contasTransferencia, setContasTransferencia] = React.useState([]);
  const [mostrarAprovacao, setMostrarAprovacao] = React.useState(false);
  const [mostrarTransferencia, setMostrarTransferencia] = React.useState(false);
  const [estornoAlvo, setEstornoAlvo] = React.useState(null);
  // Aprovada trava a proposta: o que muda depois disso é a execução, não o
  // planejamento. Retirar fornecedor, alterar valor e mexer nas contas valem
  // enquanto a programação está em elaboração ou em análise.
  const podeEditarProgramacao = podeEditar && programacao?.fechado !== true && programacao?.status !== STATUS_APROVADA;

  React.useEffect(() => {
    carregarSecretarias();
    conferirEstrutura();
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

  React.useEffect(() => {
    let ativo = true;
    carregarPermissoesFase2(permissao).then((valores) => {
      if (ativo) setPermissoesFase2(valores);
    });
    return () => { ativo = false; };
  }, [permissao]);

  // Conferência ativa, feita ao abrir a tela: diz exatamente quais colunas
  // faltam, em vez de esperar uma ação falhar e adivinhar o motivo. `limit(0)`
  // não traz linha nenhuma, então policy de RLS restritiva não é confundida
  // com estrutura ausente.
  async function conferirEstrutura() {
    const [resultado, resultadoFase2] = await Promise.all([
      verificarEstruturaFase1(supabase),
      verificarEstruturaFase2(supabase),
    ]);
    setEstrutura(resultado);
    setEstruturaFase2(resultadoFase2);
    if (typeof console !== "undefined" && resultado.falhas.length) {
      console.error("[Pagamentos Fase 1] Verificação de estrutura", {
        faltando: resultado.faltando,
        naoVerificado: resultado.naoVerificado,
        funcoesEsperadas: FUNCOES_FASE_1,
        falhas: resultado.falhas,
      });
    }
    if (typeof console !== "undefined" && resultadoFase2.falhas.length) {
      console.error("[Pagamentos Fase 2] Verificação de estrutura", {
        faltando: resultadoFase2.faltando,
        naoVerificado: resultadoFase2.naoVerificado,
        falhas: resultadoFase2.falhas,
      });
    }
  }

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
      setFornecedores(ordenarFornecedoresPorAberto((fornecedoresAtivos ?? []).map((fornecedor) => ({
        ...fornecedor,
        valor_em_aberto: numero(totais[String(fornecedor.id)]),
      }))));
    } catch (falha) {
      setErro(mensagemAmigavel(falha, "Não foi possível carregar contas e fornecedores."));
    }
  }

  async function carregarProgramacoes(preferidaId = "") {
    try {
      const { data: itens, error } = await supabase.from("programacoes_pagamento")
        .select("id, nome_programacao, status, fechado")
        .eq("secretaria_id", idInteiro(secretariaId, "Secretaria"))
        .eq("data_programacao", data)
        .order("id", { ascending: false });
      if (error) throw error;
      setProgramacoes(itens ?? []);
      const alvo = preferidaId || programacaoId;
      setProgramacaoId((itens ?? []).some((item) => String(item.id) === String(alvo)) ? alvo : itens?.[0]?.id || "");
    } catch (falha) {
      registrarErroFase1("Falha ao carregar programações", falha, { secretariaId, dataProgramacao: data });
      setErro(mensagemFalhaFase1(falha, "Não foi possível carregar as programações."));
    }
  }

  function limparEdicao() {
    setProgramacao(null);
    setTransferencias([]);
    setContasSelecionadas(new Set());
    setPagamentos([]);
    setContasConfirmadas(false);
    setFornecedoresConfirmados(false);
  }

  async function carregarProgramacao(id, { manterRecolhimento = false } = {}) {
    setErro("");
    try {
      const idProgramacao = idInteiro(id, "Programação");
      const [{ data: programa, error: erroPrograma }, { data: vinculadas, error: erroContas }, { data: itens, error: erroPagamentos }] = await Promise.all([
        supabase.from("programacoes_pagamento").select("id, nome_programacao, data_programacao, status, fechado, responsavel_id").eq("id", idProgramacao).single(),
        supabase.from("programacao_contas").select("conta_id, saldo_considerado, ordem").eq("programacao_id", idProgramacao).eq("ativa", true).order("ordem"),
        supabase.from("pagamentos").select("id, fornecedor_id, valor_a_pagar, nome_avulso, cadastrar_fornecedor_posteriormente, fornecedores(razao_social)").eq("programacao_id", idProgramacao).is("excluido_em", null).order("id"),
      ]);
      if (erroPrograma) throw erroPrograma;
      if (erroContas) throw erroContas;
      if (erroPagamentos) throw erroPagamentos;
      const { data: responsavel } = programa?.responsavel_id
        ? await supabase.from("usuarios").select("nome_completo").eq("id", programa.responsavel_id).maybeSingle()
        : { data: null };
      const contaPorPagamento = await contasDefinidasDosPagamentos(idProgramacao);
      setProgramacao({ ...programa, responsavel });
      setContasSelecionadas(new Set((vinculadas ?? []).map((item) => item.conta_id)));
      setPagamentos((itens ?? []).map((item) => ({
        ...item,
        valor_a_pagar: numero(item.valor_a_pagar),
        conta_origem_id: contaPorPagamento.get(String(item.id)) ?? null,
      })));
      if (programa?.status === STATUS_APROVADA) await atualizarTransferencias(idProgramacao);
      else setTransferencias([]);
      // Programação que já tem escolha feita abre recolhida; vazia abre com as
      // listas visíveis para a seleção começar. Recarga feita depois de salvar
      // mantém a tela como o usuário deixou -- salvar não recolhe nem reabre.
      if (!manterRecolhimento) {
        setContasConfirmadas((vinculadas ?? []).length > 0);
        setFornecedoresConfirmados((itens ?? []).length > 0);
      }
    } catch (falha) {
      registrarErroFase1("Falha ao abrir programação", falha, { programacaoId: id });
      setErro(mensagemFalhaFase1(falha, "Não foi possível abrir a programação."));
    }
  }

  async function criarProgramacao() {
    if (!secretariaId || !podeEditar) return;
    setSalvando(true);
    setErro("");
    try {
      const { data: auth, error: erroAuth } = await supabase.auth.getUser();
      if (erroAuth) throw erroAuth;
      if (!auth.user?.id) throw new Error("Usuário não autenticado.");
      const secretariaIdInteiro = idInteiro(secretariaId, "Secretaria");
      const { data: criada, error } = await supabase.from("programacoes_pagamento").insert({
        secretaria_id: secretariaIdInteiro,
        data_programacao: data,
        responsavel_id: auth.user.id,
        nome_programacao: nomeAutomatico(data),
      }).select("id, data_programacao").single();
      if (error) throw error;
      setData(criada.data_programacao);
      setProgramacaoId(criada.id);
      await carregarProgramacoes(criada.id);
      setMensagem("Programação criada em elaboração.");
    } catch (falha) {
      registrarErroFase1("Falha ao criar programação", falha, { secretariaId, dataProgramacao: data });
      setErro(mensagemFalhaFase1(falha, "Não foi possível criar a programação."));
    } finally {
      setSalvando(false);
    }
  }

  // Confirmar/reabrir um bloco é só apresentação: não grava, não movimenta
  // saldo e não recalcula nada -- os totalizadores do topo continuam saindo das
  // mesmas contas selecionadas e dos mesmos valores propostos.
  function confirmarContas() {
    setContasConfirmadas(true);
  }

  function alterarContas() {
    setContasConfirmadas(false);
  }

  function confirmarFornecedores() {
    setFornecedoresConfirmados(true);
  }

  function alterarFornecedores() {
    setFornecedoresConfirmados(false);
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
      const { data: auth, error: erroAuth } = await supabase.auth.getUser();
      if (erroAuth) throw erroAuth;
      if (!auth.user?.id) throw new Error("Usuário não autenticado.");
      const selecionadas = contas.filter((conta) => contasSelecionadas.has(conta.id));
      const payloadContas = selecionadas.map((conta, indice) => ({
        conta_id: idInteiro(conta.id, "Conta"),
        saldo_considerado: numero(conta.saldo),
        ordem: indice + 1,
      }));
      // Fornecedor avulso não tem fornecedor_id: o campo vai NULO e o nome vai
      // em nome_avulso. Campo vazio ou zero é ausência de fornecedor, não id --
      // mandá-lo como id faria o banco recusar o vínculo (23503). O que sai daqui
      // é id inteiro válido ou nulo, nunca "" e nunca 0.
      const payloadPagamentos = pagamentos.map((item) => ({
        id: vazio(item.id) ? null : idInteiro(item.id, "Pagamento"),
        fornecedor_id: vazio(item.fornecedor_id) ? null : idInteiro(item.fornecedor_id, "Fornecedor"),
        nome_avulso: typeof item.nome_avulso === "string" ? item.nome_avulso.trim() || null : null,
        valor_a_pagar: numero(item.valor_a_pagar),
        cadastrar_fornecedor_posteriormente: Boolean(item.cadastrar_fornecedor_posteriormente),
      }));
      const programacaoIdInteiro = idInteiro(programacao.id, "Programação");
      const argumentos = {
        p_programacao_id: programacaoIdInteiro,
        p_contas: payloadContas,
        p_pagamentos: payloadPagamentos,
        p_saldo_considerado: totalDisponivel,
        p_total_programado: totalProgramado,
        p_restante: restante,
      };
      // A tela salva antes de aprovar, então uma recusa aqui aparece como falha
      // de aprovação. Registrar os argumentos exatos separa os dois casos na
      // investigação, sem depender da mensagem exibida.
      if (typeof console !== "undefined") {
        console.info("[Pagamentos Fase 1] rpc salvar_planejamento_programacao", argumentos);
      }
      const { error } = await supabase.rpc("salvar_planejamento_programacao", argumentos);
      if (error) throw error;
      setMensagem("Programação salva com contas, fornecedores e valores preservados.");
      await carregarProgramacao(programacao.id, { manterRecolhimento: true });
      await carregarProgramacoes(programacao.id);
      return true;
    } catch (falha) {
      registrarErroFase1("Falha ao salvar programação", falha, { programacaoId: programacao?.id });
      setErro(mensagemFalhaFase1(falha, "Não foi possível salvar a programação."));
    } finally {
      setSalvando(false);
    }
    return false;
  }

  async function marcarEmAnalise() {
    if (!programacao || !podeEditarProgramacao) return;
    const salvo = await salvarProgramacao();
    if (!salvo) return;
    const { error } = await supabase.rpc("marcar_programacao_em_analise", { p_programacao_id: idInteiro(programacao.id, "Programação") });
    if (error) {
      registrarErroFase1("Falha ao marcar programação em análise", error, { programacaoId: programacao.id });
      return setErro(mensagemFalhaFase1(error, "Não foi possível marcar como em análise."));
    }
    setProgramacao((atual) => ({ ...atual, status: "em_analise" }));
    setMensagem("Programação marcada como em análise. Nenhum saldo foi movimentado.");
    await carregarProgramacoes(programacao.id);
  }

  // A conta de cada pagamento é lida em consulta própria e tolerante a falha:
  // se a migration da Fase 2 ainda não rodou, a coluna não existe, a
  // programação abre normalmente sem a informação e o aviso do topo explica o
  // que executar. Sem isto a tela inteira quebraria por causa de uma coluna.
  async function contasDefinidasDosPagamentos(idProgramacao) {
    const { data: itens, error } = await supabase
      .from("pagamentos")
      .select("id, conta_origem_id")
      .eq("programacao_id", idProgramacao)
      .is("excluido_em", null);
    if (error) {
      registrarErroFase2("Falha ao ler a conta definida de cada pagamento", error, { programacaoId: idProgramacao });
      return new Map();
    }
    return new Map((itens ?? []).map((item) => [String(item.id), item.conta_origem_id ?? null]));
  }

  async function atualizarTransferencias(id) {
    try {
      setTransferencias(await carregarTransferenciasDaProgramacao(idInteiro(id, "Programação")));
    } catch (falha) {
      registrarErroFase2("Falha ao carregar as transferências da programação", falha, { programacaoId: id });
      setTransferencias([]);
    }
  }

  // APROVAR NÃO É PAGAR: a aprovação grava a proposta como ela está na tela,
  // troca o status e registra a conferência. Não debita conta, não dá baixa em
  // nota, não altera saldo de fornecedor e não marca nota como paga.
  async function confirmarAprovacao() {
    if (!programacao) return;
    const salvo = await salvarProgramacao();
    if (!salvo) return;
    setSalvando(true);
    setErro("");
    setMensagem("");
    try {
      await aprovarProgramacao({
        programacaoId: idInteiro(programacao.id, "Programação"),
        saldoConsiderado: totalDisponivel,
        totalProgramado,
        restante,
      });
      setMostrarAprovacao(false);
      setMensagem("Programação aprovada e aguardando execução. Nenhuma conta foi debitada: aprovar não é pagar.");
      await carregarProgramacao(programacao.id, { manterRecolhimento: true });
      await carregarProgramacoes(programacao.id);
    } catch (falha) {
      registrarErroFase2("Falha ao aprovar programação", falha, { programacaoId: programacao.id });
      setErro(mensagemFalhaFase2(falha, "Não foi possível aprovar a programação."));
    } finally {
      setSalvando(false);
    }
  }

  // ATRIBUIR CONTA NÃO DEBITA CONTA: o vínculo é o roteiro do pagamento. O
  // mesmo caminho atende um pagamento, os marcados e todos -- e depois de
  // aplicar em lote a troca individual continua possível.
  async function gravarContaDosPagamentos(ids, contaId) {
    if (!programacao) return;
    const alvos = (ids ?? []).filter((id) => id != null).map((id) => idInteiro(id, "Pagamento"));
    if (!alvos.length) {
      setErro("Salve a programação antes de definir a conta destes pagamentos.");
      return;
    }
    setSalvando(true);
    setErro("");
    setMensagem("");
    try {
      const conta = contaId ? idInteiro(contaId, "Conta") : null;
      await definirContaDePagamentos({
        programacaoId: idInteiro(programacao.id, "Programação"),
        pagamentoIds: alvos,
        contaId: conta,
      });
      setPagamentos((itens) => aplicarContaEmPagamentos(itens, alvos, conta));
      setMensagem(alvos.length === 1
        ? "Conta do pagamento definida. Definir conta não debita conta."
        : `Conta definida em ${alvos.length} pagamentos. Definir conta não debita conta.`);
    } catch (falha) {
      registrarErroFase2("Falha ao definir a conta do pagamento", falha, { programacaoId: programacao.id, pagamentos: alvos });
      setErro(mensagemFalhaFase2(falha, "Não foi possível definir a conta destes pagamentos."));
    } finally {
      setSalvando(false);
    }
  }

  async function garantirContasDeTransferencia() {
    const carregadas = await carregarContasParaTransferencia({ secretariaId, secretarias });
    setContasTransferencia(carregadas);
    return carregadas;
  }

  async function abrirTransferencia() {
    setErro("");
    try {
      await garantirContasDeTransferencia();
      setMostrarTransferencia(true);
    } catch (falha) {
      registrarErroFase2("Falha ao carregar as contas para transferência", falha, { secretariaId });
      setErro(mensagemFalhaFase2(falha, "Não foi possível carregar as contas para a transferência."));
    }
  }

  async function abrirEstorno(transferencia) {
    setErro("");
    if (contasTransferencia.length === 0) {
      try {
        await garantirContasDeTransferencia();
      } catch (falha) {
        registrarErroFase2("Falha ao carregar contas para o estorno", falha, { secretariaId });
      }
    }
    setEstornoAlvo(transferencia);
  }

  // Depois de uma transferência confirmada ou estornada o saldo mudou de
  // verdade: as contas são recarregadas da mesma fonte que alimenta a aba
  // Saldos das Contas, então as duas telas mostram o novo saldo na hora.
  async function aposMovimentoDeSaldo(aviso) {
    await carregarBase();
    if (programacao) await atualizarTransferencias(programacao.id);
    setMensagem(aviso);
  }

  // O documento leva só o que foi escolhido: contas selecionadas e fornecedores
  // propostos. Os pagamentos vão em duas colunas -- fornecedor e valor -- e é a
  // mesma carga usada na impressão, no PDF e na planilha.
  function dadosDocumento() {
    return {
      titulo: "PROGRAMAÇÃO DIÁRIA DE PAGAMENTOS",
      secretaria: nomeSecretariaSelecionada,
      data: dataBR(programacao.data_programacao),
      emissao: agoraBR(),
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

  function exportarExcel() {
    exportarExcelProgramacao(dadosDocumento());
  }

  const contasFiltradas = contas.filter((conta) => textoConta(conta).includes(buscaConta.trim().toLocaleLowerCase("pt-BR")));
  const contasSelecionadasComSaldo = contas.filter((conta) => contasSelecionadas.has(conta.id));
  const totalDisponivel = somarContasSelecionadas(contas, contasSelecionadas);
  const totalProgramado = somarPagamentos(pagamentos);
  const restante = calcularRestante(totalDisponivel, totalProgramado);
  const idsSelecionados = new Set(pagamentos.filter((item) => item.fornecedor_id).map((item) => String(item.fornecedor_id)));
  const fornecedoresFiltrados = fornecedores.filter((item) => item.razao_social.toLocaleLowerCase("pt-BR").includes(buscaFornecedor.trim().toLocaleLowerCase("pt-BR")));
  const todasVisiveisMarcadas = contasFiltradas.length > 0 && contasFiltradas.every((conta) => contasSelecionadas.has(conta.id));
  const nomeSecretariaSelecionada = secretarias.find((item) => String(item.id) === String(secretariaId))?.nome || "--";
  const emEtapaDeExecucao = emExecucao(programacao);
  const emRevisao = emRevisaoPosAnalise(programacao);
  const resumoDaAprovacao = resumoAprovacao({ contasSelecionadas: contasSelecionadasComSaldo, pagamentos });
  const impedimentosDaAprovacao = impedimentosParaAprovar({ programacao, contasSelecionadas: contasSelecionadasComSaldo, pagamentos });
  const fase2Indisponivel = estruturaFase2 != null && estruturaFase2.ok === false;
  const nomeDaConta = (id) => [...contas, ...contasTransferencia].find((item) => String(item.id) === String(id))?.nome_conta || `Conta ${id ?? "--"}`;

  return (
    <Layout titulo="Pagamentos Diários" subtitulo="Planejamento diário para análise da gestão">
      <div className="mx-auto max-w-[1500px] px-4 pb-10 sm:px-6">
        {/* Faixa fina e sempre visível: os três totais de um lado, a impressão do
            outro. É desta tela que sai o papel levado ao gestor, então o botão de
            impressão não pode depender de rolagem. */}
        <div className="sticky top-0 z-30 -mx-4 mb-3 border-b border-[#17352F]/10 bg-[#F5F3EC]/95 px-4 py-2 shadow-[0_6px_18px_rgba(23,53,47,0.07)] backdrop-blur sm:-mx-6 sm:px-6">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-2">
            <div className="grid min-w-[20rem] flex-1 gap-1.5 sm:grid-cols-3">
              <div className="flex items-baseline justify-between gap-2 rounded-lg bg-white px-2.5 py-1"><span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#17352F]/55">Saldo da programação</span><strong className="text-[15px] font-bold tabular-nums text-[#17352F]">{formatBRL(totalDisponivel)}</strong></div>
              <div className="flex items-baseline justify-between gap-2 rounded-lg bg-white px-2.5 py-1"><span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#17352F]/55">Total programado</span><strong className="text-[15px] font-bold tabular-nums text-[#17352F]">{formatBRL(totalProgramado)}</strong></div>
              <div className={`flex items-baseline justify-between gap-2 rounded-lg px-2.5 py-1 ${restante < 0 ? "bg-[#FBE9DF] text-[#8A321C]" : "bg-[#E5EFEA] text-[#17352F]"}`}><span className="text-[9px] font-semibold uppercase tracking-[0.1em] opacity-70">Restante</span><strong className="text-[15px] font-bold tabular-nums">{formatBRL(restante)}</strong></div>
            </div>
            {programacao && <div className="flex gap-1.5 print:hidden">
              <button onClick={imprimir} className="inline-flex items-center gap-1.5 rounded-lg bg-[#17352F] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-white hover:bg-[#0F2823]"><Printer size={14}/> Imprimir programação para análise</button>
              <button onClick={gerarPdf} className="inline-flex items-center gap-1.5 rounded-lg border border-[#17352F]/25 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[#17352F] hover:bg-[#F2F0E8]"><FileDown size={14}/> PDF</button>
              <button onClick={exportarExcel} className="inline-flex items-center gap-1.5 rounded-lg border border-[#17352F]/25 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[#17352F] hover:bg-[#F2F0E8]"><FileSpreadsheet size={14}/> Excel</button>
            </div>}
          </div>
          {restante < 0 && <p className="mx-auto mt-1.5 max-w-[1500px] rounded-md bg-[#8A321C] px-2.5 py-1 text-center text-[11px] font-semibold text-white"><AlertTriangle size={12} className="mr-1 inline"/> PROGRAMAÇÃO ACIMA DO SALDO DISPONÍVEL — diferença de {formatBRL(Math.abs(restante))}</p>}
        </div>

        <div className="mb-3 grid gap-2 rounded-xl border border-[#17352F]/10 bg-white p-2.5 shadow-sm print:hidden lg:grid-cols-[1fr_12rem_auto] lg:items-end">
          <label className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#17352F]/60">Secretaria<select value={secretariaId} onChange={(evento) => setSecretariaId(evento.target.value)} className="mt-0.5 block w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-[13px] font-normal normal-case tracking-normal">{secretarias.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
          <label className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#17352F]/60">Data<input type="date" value={data} onChange={(evento) => setData(evento.target.value)} className="mt-0.5 block w-full rounded-lg border border-black/10 px-2 py-1.5 text-[13px] font-normal"/></label>
          <button onClick={criarProgramacao} disabled={!podeEditar || salvando} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#17352F] px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"><Plus size={15}/> Nova programação</button>
        </div>

        {estrutura && !estrutura.ok && <div className="mb-3 rounded-xl border border-[#8A321C]/25 bg-[#FBE9DF] px-3 py-2 text-[13px] text-[#8A321C] print:hidden">
          <p className="font-semibold"><AlertTriangle size={14} className="mr-1 inline"/> Estrutura da Fase 1 incompleta no banco conectado a esta tela</p>
          <p className="mt-1">Não existe no banco: <strong>{listaLegivel(estrutura.faltando)}</strong>.</p>
          <p className="mt-1">Execute {MIGRATION_FASE_1} e {MIGRATION_REPARO_FASE_1} no mesmo projeto Supabase usado pela aplicação e recarregue a página. O erro completo de cada objeto está no console (F12).</p>
          {estrutura.naoVerificado.length > 0 && <p className="mt-1 text-[11px]">Sem permissão para conferir: {listaLegivel(estrutura.naoVerificado)} — estes não estão sendo acusados de faltar.</p>}
        </div>}

        {/* A tela funciona antes de a migration da Fase 2 rodar: o aviso diz o
            que falta e só a aprovação, a execução e a transferência ficam
            indisponíveis. Nada do planejamento é afetado. */}
        {estruturaFase2 && !estruturaFase2.ok && <div className="mb-3 rounded-xl border border-[#B98C55]/40 bg-[#FBF3EA] px-3 py-2 text-[13px] text-[#8A321C] print:hidden">
          <p className="font-semibold"><AlertTriangle size={14} className="mr-1 inline"/> Estrutura da execução financeira (Fase 2) incompleta no banco conectado a esta tela</p>
          <p className="mt-1">Não existe no banco: <strong>{listaLegivel(estruturaFase2.faltando)}</strong>.</p>
          <p className="mt-1">Execute {MIGRATION_FASE_2} no SQL Editor do mesmo projeto Supabase usado pela aplicação e recarregue a página. A revisão, a impressão e o restante do planejamento continuam funcionando; apenas aprovar, executar e transferir ficam indisponíveis.</p>
          {estruturaFase2.naoVerificado.length > 0 && <p className="mt-1 text-[11px]">Sem permissão para conferir: {listaLegivel(estruturaFase2.naoVerificado)} — estes não estão sendo acusados de faltar.</p>}
        </div>}

        {(erro || mensagem) && <div className={`mb-3 rounded-xl px-3 py-2 text-[13px] print:hidden ${erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{erro || mensagem}<button onClick={() => { setErro(""); setMensagem(""); }} className="float-right"><X size={15}/></button></div>}

        {carregando ? <p className="py-12 text-center text-[13px] text-[#17352F]/55">Carregando...</p> : <>
          {programacoes.length > 0 && <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1 print:hidden">{programacoes.map((item) => <button key={item.id} onClick={() => setProgramacaoId(item.id)} className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-semibold ${String(programacaoId) === String(item.id) ? "border-[#17352F] bg-[#17352F] text-white" : "border-black/10 bg-white text-[#17352F]"}`}>{item.nome_programacao} · {statusLabel(item.status, item.fechado)}</button>)}</div>}

          {!programacao ? <div className="rounded-xl border border-dashed border-[#17352F]/20 bg-white/60 px-4 py-12 text-center"><h2 className="font-serif text-lg text-[#17352F]">Comece uma programação diária</h2><p className="mt-1 text-[12px] text-[#17352F]/55">Planejamento apenas: nenhuma conta é debitada ou bloqueada.</p></div> : <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#17352F] px-3 py-2 text-white">
              <div className="min-w-0"><h1 className="truncate text-[15px] font-semibold">{programacao.nome_programacao}</h1><p className="text-[10px] uppercase tracking-[0.1em] text-white/55">{statusLabel(programacao.status, programacao.fechado)} · ID {programacao.id} · {dataBR(programacao.data_programacao)}</p></div>
              <div className="flex flex-wrap gap-2 print:hidden"><button onClick={salvarProgramacao} disabled={salvando || !podeEditarProgramacao} className="rounded-lg bg-white px-3 py-1.5 text-[12px] font-semibold text-[#17352F] disabled:opacity-50">{salvando ? "Salvando..." : "Salvar programação"}</button>{programacao.status !== "em_analise" && !programacao.fechado && <button onClick={marcarEmAnalise} disabled={!podeEditarProgramacao} className="inline-flex items-center gap-1.5 rounded-lg bg-[#B98C55] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"><Check size={14}/> Marcar em análise</button>}{podeRevisarProposta(programacao) && <button onClick={() => setMostrarAprovacao(true)} disabled={salvando || !podeEditarProgramacao || fase2Indisponivel || permissoesFase2?.aprovar_programacao === false || impedimentosDaAprovacao.length > 0} title={fase2Indisponivel ? "Execute a migration da Fase 2 para aprovar." : permissoesFase2?.aprovar_programacao === false ? "Você não tem permissão para aprovar programação." : impedimentosDaAprovacao[0] || "Aprovar não movimenta saldo"} className="inline-flex items-center gap-1.5 rounded-lg bg-[#B06A3C] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"><Check size={14}/> APROVAR PROGRAMAÇÃO</button>}</div>
            </div>

            {/* Volta da reunião com o gestor: a MESMA programação é reaberta
                para ajuste. Retirar da programação não é excluir fornecedor --
                sai só desta programação, e cadastro, notas, processos,
                histórico, dados de banco e certidões ficam intactos. */}
            {emRevisao && <div className="mb-3 rounded-xl border border-[#B98C55]/40 bg-[#FBF3EA] px-3 py-2 print:hidden">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#8A321C]">Revisão após a análise</p>
              <p className="mt-1 text-[12px] text-[#17352F]">Acrescentar fornecedor, retirar fornecedor, alterar valor, acrescentar conta e retirar conta nesta mesma programação. Cada mudança recalcula na hora o saldo da programação, o total programado e o restante.</p>
              <p className="mt-1 text-[11px] text-[#17352F]/70">Retirar da programação não é excluir fornecedor: sai apenas desta programação. O cadastro, as notas, os processos, o histórico, os dados de banco e PIX e as certidões continuam intactos.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={alterarContas} disabled={!podeEditarProgramacao} className="rounded-lg border border-[#17352F]/25 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#17352F] hover:bg-[#F2F0E8] disabled:opacity-50">REVISAR CONTAS</button>
                <button onClick={alterarFornecedores} disabled={!podeEditarProgramacao} className="rounded-lg border border-[#17352F]/25 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#17352F] hover:bg-[#F2F0E8] disabled:opacity-50">REVISAR FORNECEDORES</button>
              </div>
            </div>}

            <div className="grid gap-3 xl:grid-cols-[1.05fr_.95fr]">
              <section className="overflow-hidden rounded-xl border border-[#17352F]/10 bg-white shadow-sm">
                <div className="border-b border-black/5 px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#17352F]"><span className="text-[#B06A3C]">1.</span> Contas de trabalho</h2>
                    <span className="text-[10px] text-[#17352F]/45 print:hidden">{contasConfirmadas ? "Confirmadas — seleção não movimenta saldo" : "Selecionar não movimenta saldo"}</span>
                  </div>
                  {!contasConfirmadas && <div className="relative mt-3 print:hidden"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#17352F]/40"/><input value={buscaConta} onChange={(evento) => setBuscaConta(evento.target.value)} placeholder="Buscar banco, conta ou nome" className="w-full rounded-lg border border-black/10 py-1.5 pl-8 pr-2 text-[13px]"/></div>}
                </div>

                {/* Lista completa: só enquanto a seleção não foi confirmada, e nunca no papel. */}
                {!contasConfirmadas && <div className="print:hidden">
                  <label className="grid cursor-pointer grid-cols-[1.6rem_1fr] border-b border-black/5 bg-[#F2F0E8] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[#17352F]"><input type="checkbox" checked={todasVisiveisMarcadas} onChange={selecionarTodas} className="h-3.5 w-3.5 accent-[#17352F]"/> Selecionar todas</label>
                  <div className="max-h-[430px] overflow-y-auto"><div className="hidden grid-cols-[1.6rem_1.1fr_1fr_1fr_1.2fr] gap-2 border-b border-black/5 px-3 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#17352F]/45 md:grid"><span></span><span>Banco</span><span>Nº da conta</span><span>Saldo</span><span>Nome da conta</span></div>{contasFiltradas.map((conta) => <label key={conta.id} className={`grid cursor-pointer items-center gap-1 border-b border-black/5 px-3 py-1 text-[13px] leading-tight last:border-0 md:grid-cols-[1.6rem_1.1fr_1fr_1fr_1.2fr] md:gap-2 ${contasSelecionadas.has(conta.id) ? "bg-[#E8F0EC]" : "hover:bg-[#FAF9F5]"}`}><input type="checkbox" checked={contasSelecionadas.has(conta.id)} onChange={() => alternarConta(conta.id)} className="h-3.5 w-3.5 accent-[#17352F]"/><span className="truncate">{conta.banco}</span><span className="truncate">{conta.numero_conta || "--"}</span><strong className="tabular-nums">{formatBRL(conta.saldo)}</strong><span className="truncate">{conta.nome_conta || "--"}</span></label>)}</div>
                </div>}

                {/* Resumo do que foi escolhido: na tela quando confirmado, na impressão sempre. */}
                <div className={contasConfirmadas ? "" : "hidden print:block"}>
                  <div className="hidden grid-cols-[1.1fr_1fr_1fr_1.2fr] gap-2 border-b border-black/5 px-3 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#17352F]/45 md:grid print:grid"><span>Banco</span><span>Nº da conta</span><span>Saldo</span><span>Nome da conta</span></div>
                  {contasSelecionadasComSaldo.length === 0 ? <p className="px-3 py-5 text-center text-[13px] text-[#17352F]/45">Nenhuma conta selecionada.</p> : contasSelecionadasComSaldo.map((conta) => <div key={conta.id} className="grid items-center gap-0.5 border-b border-black/5 px-3 py-1 text-[13px] leading-tight last:border-0 md:grid-cols-[1.1fr_1fr_1fr_1.2fr] md:gap-2 print:grid-cols-[1.1fr_1fr_1fr_1.2fr]"><span className="truncate">{conta.banco}</span><span className="truncate">{conta.numero_conta || "--"}</span><strong className="tabular-nums">{formatBRL(conta.saldo)}</strong><span className="truncate">{conta.nome_conta || "--"}</span></div>)}
                </div>

                <div className="bg-[#17352F] px-3 py-1.5 text-[11px] font-bold tracking-[0.04em] text-white">{contasSelecionadas.size} {contasSelecionadas.size === 1 ? "CONTA SELECIONADA" : "CONTAS SELECIONADAS"} — SALDO TOTAL DA PROGRAMAÇÃO: {formatBRL(totalDisponivel)}</div>

                <div className="flex justify-end border-t border-black/5 px-3 py-2 print:hidden">{contasConfirmadas ? <button onClick={alterarContas} className="rounded-lg border border-[#17352F]/25 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#17352F] hover:bg-[#F2F0E8]">ALTERAR CONTAS</button> : <button onClick={confirmarContas} disabled={contasSelecionadas.size === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-[#17352F] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-white disabled:opacity-40"><Check size={13}/> CONFIRMAR CONTAS</button>}</div>
              </section>

              <section className="overflow-hidden rounded-xl border border-[#17352F]/10 bg-white shadow-sm">
                <div className="border-b border-black/5 px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#17352F]"><span className="text-[#B06A3C]">2.</span> Proposta</h2>
                    <span className="text-[10px] text-[#17352F]/45 print:hidden">{fornecedoresConfirmados ? "Fornecedores confirmados" : "Maior valor em aberto primeiro"}</span>
                  </div>
                  {!fornecedoresConfirmados && <div className="relative mt-3 print:hidden"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#17352F]/40"/><input value={buscaFornecedor} onChange={(evento) => setBuscaFornecedor(evento.target.value)} placeholder="Buscar fornecedor" className="w-full rounded-lg border border-black/10 py-1.5 pl-8 pr-2 text-[13px]"/></div>}
                </div>

                {/* Lista completa, na ordem do maior valor em aberto para o menor. */}
                {!fornecedoresConfirmados && <div className="max-h-[330px] overflow-y-auto print:hidden">{fornecedoresFiltrados.map((fornecedor) => { const marcado = idsSelecionados.has(String(fornecedor.id)); return <label key={fornecedor.id} className={`grid cursor-pointer grid-cols-[1.6rem_1fr_auto] items-center gap-2 border-b border-black/5 px-3 py-1 text-[13px] leading-tight last:border-0 ${marcado ? "bg-[#E8F0EC]" : "hover:bg-[#FAF9F5]"}`}><input type="checkbox" checked={marcado} onChange={() => alternarFornecedor(fornecedor)} className="h-3.5 w-3.5 accent-[#17352F]"/><span className="truncate font-medium text-[#17352F]">{fornecedor.razao_social}</span><span className={fornecedor.valor_em_aberto > 0 ? "font-bold tabular-nums text-[#B05D31]" : "text-[#17352F]/40"}>{formatBRL(fornecedor.valor_em_aberto)}</span></label>; })}</div>}

                {/* Escolhidos, com o valor editável ao lado: na tela quando confirmado, na impressão sempre. */}
                <div className={fornecedoresConfirmados ? "" : "hidden print:block"}>
                  {pagamentos.length === 0 ? <p className="px-3 py-5 text-center text-[13px] text-[#17352F]/45">Nenhum fornecedor escolhido.</p> : pagamentos.map((pagamento, indice) => <div key={pagamento.id || `${pagamento.nome_avulso || pagamento.fornecedor_id}-${indice}`} className="grid gap-1 border-b border-black/5 px-3 py-1 text-[13px] leading-tight last:border-0 sm:grid-cols-[1fr_9rem_auto] sm:items-center sm:gap-2"><div className="min-w-0"><strong className="block truncate text-[#17352F]">{nomePagamento(pagamento)}</strong>{pagamento.cadastrar_fornecedor_posteriormente && <small className="text-[10px] text-[#A5542F]">Cadastrar posteriormente</small>}</div><CampoMoeda valor={pagamento.valor_a_pagar} onValorChange={(valor) => editarValor(pagamento, valor)} aria-label={`Valor a pagar para ${nomePagamento(pagamento)}`} className="w-full rounded-lg border border-black/10 px-2 py-1 text-right text-[13px] font-bold normal-case tracking-normal text-[#17352F] print:hidden"/><strong className="hidden text-right tabular-nums print:block">{formatBRL(pagamento.valor_a_pagar)}</strong><button onClick={() => setPagamentos((itens) => itens.filter((item) => item !== pagamento))} className="rounded p-1 text-red-600 hover:bg-red-50 print:hidden" aria-label={`Retirar ${nomePagamento(pagamento)} da programação`}><Trash2 size={14}/></button></div>)}
                  <div className="bg-[#17352F] px-3 py-1.5 text-[11px] font-bold tracking-[0.04em] text-white">{pagamentos.length} {pagamentos.length === 1 ? "FORNECEDOR ESCOLHIDO" : "FORNECEDORES ESCOLHIDOS"} — TOTAL PROGRAMADO: {formatBRL(totalProgramado)}</div>
                </div>

                <div className="border-t border-black/5 p-2.5 print:hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2"><button onClick={() => setMostrarAvulso((valor) => !valor)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#A5542F]"><Plus size={14}/> Adicionar fornecedor avulso</button>{fornecedoresConfirmados ? <button onClick={alterarFornecedores} className="rounded-lg border border-[#17352F]/25 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#17352F] hover:bg-[#F2F0E8]">ALTERAR FORNECEDORES</button> : <button onClick={confirmarFornecedores} disabled={pagamentos.length === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-[#17352F] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-white disabled:opacity-40"><Check size={13}/> CONFIRMAR FORNECEDORES</button>}</div>
                  {mostrarAvulso && <div className="mt-2 grid gap-2 rounded-lg bg-[#FBF3EA] p-2 sm:grid-cols-[1fr_9rem_auto]"><input value={avulso.nome} onChange={(evento) => setAvulso({ ...avulso, nome: evento.target.value })} placeholder="Nome" className="rounded-lg border border-black/10 px-2 py-1.5 text-[13px]"/><CampoMoeda valor={avulso.valor} onValorChange={(valor) => setAvulso({ ...avulso, valor })} className="rounded-lg border border-black/10 px-2 py-1.5 text-right text-[13px]"/><button onClick={adicionarAvulso} className="rounded-lg bg-[#A5542F] px-3 py-1.5 text-[13px] font-semibold text-white">Adicionar</button><label className="flex items-center gap-2 text-[11px] text-[#17352F]/65 sm:col-span-3"><input type="checkbox" checked={avulso.cadastrarDepois} onChange={(evento) => setAvulso({ ...avulso, cadastrarDepois: evento.target.checked })} className="h-3.5 w-3.5"/> Cadastrar posteriormente como fornecedor</label></div>}
                </div>
              </section>
            </div>

            {/* Bloco 3 é o detalhamento de quem já está escolhido enquanto a lista
                está aberta. Depois de confirmar, o valor editável passa a ficar no
                próprio bloco 2 e este sai da tela para não repetir a mesma lista. */}
            {!fornecedoresConfirmados && <section className="mt-3 overflow-hidden rounded-xl border border-[#17352F]/10 bg-white shadow-sm print:hidden">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-black/5 px-3 py-2"><h2 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#17352F]"><span className="text-[#B06A3C]">3.</span> Valores</h2><span className="text-[10px] text-[#17352F]/45">Valor editável, pode ser menor que o aberto</span></div>
              {pagamentos.length === 0 ? <p className="px-3 py-6 text-center text-[13px] text-[#17352F]/45">Selecione fornecedores ou adicione um avulso.</p> : <div>{pagamentos.map((pagamento, indice) => <div key={pagamento.id || `${pagamento.nome_avulso || pagamento.fornecedor_id}-${indice}`} className="grid gap-1 border-b border-black/5 px-3 py-1 text-[13px] leading-tight last:border-0 sm:grid-cols-[1fr_9rem_auto] sm:items-center sm:gap-2"><div className="min-w-0"><strong className="block truncate text-[#17352F]">{nomePagamento(pagamento)}</strong>{pagamento.cadastrar_fornecedor_posteriormente && <small className="text-[10px] text-[#A5542F]">Cadastrar posteriormente</small>}</div><CampoMoeda valor={pagamento.valor_a_pagar} onValorChange={(valor) => editarValor(pagamento, valor)} aria-label={`Valor a programar para ${nomePagamento(pagamento)}`} className="w-full rounded-lg border border-black/10 px-2 py-1 text-right text-[13px] font-bold normal-case tracking-normal text-[#17352F]"/><button onClick={() => setPagamentos((itens) => itens.filter((item) => item !== pagamento))} className="rounded p-1 text-red-600 hover:bg-red-50" aria-label={`Retirar ${nomePagamento(pagamento)} da programação`}><Trash2 size={14}/></button></div>)}</div>}
            </section>}

            {/* Etapa de execução: a conta é definida POR PAGAMENTO. Nenhuma
                operação daqui movimenta saldo, exceto a transferência entre
                contas confirmada. */}
            {emEtapaDeExecucao && <div className="mt-3 print:hidden">
              <PainelExecucaoProgramacao
                programacao={programacao}
                pagamentos={pagamentos}
                contas={contas}
                contasSelecionadas={contasSelecionadas}
                secretariaId={secretariaId}
                nomePagamento={nomePagamento}
                transferencias={transferencias}
                permissoes={fase2Indisponivel ? { definir_conta_pagamento: false, executar_programacao: false, executar_transferencia: false, estornar_transferencia: false } : (permissoesFase2 ?? {})}
                salvando={salvando}
                onDefinirConta={(pagamento, contaId) => gravarContaDosPagamentos([pagamento.id], contaId)}
                onAtribuirAosSelecionados={(ids, contaId) => gravarContaDosPagamentos(ids, contaId)}
                onAplicarATodos={(contaId) => gravarContaDosPagamentos(pagamentos.map((item) => item.id), contaId)}
                onTransferir={abrirTransferencia}
                onEstornar={abrirEstorno}
              />
            </div>}
          </>}
        </>}
        {mostrarAprovacao && programacao && <ModalAprovacaoProgramacao
          resumo={resumoDaAprovacao}
          programacao={programacao}
          salvando={salvando}
          onFechar={() => setMostrarAprovacao(false)}
          onConfirmar={confirmarAprovacao}
        />}

        {mostrarTransferencia && programacao && <ModalTransferenciaEntreContas
          programacao={programacao}
          contas={contasTransferencia}
          onFechar={() => setMostrarTransferencia(false)}
          onConcluida={() => aposMovimentoDeSaldo("Transferência confirmada. Transferência entre contas próprias não é despesa: o patrimônio total continua igual.")}
        />}

        {estornoAlvo && <ModalEstornoTransferencia
          transferencia={estornoAlvo}
          nomeConta={nomeDaConta}
          onFechar={() => setEstornoAlvo(null)}
          onConcluido={() => aposMovimentoDeSaldo("Transferência estornada. A original continua registrada no histórico e na auditoria.")}
        />}
      </div>
    </Layout>
  );
}
