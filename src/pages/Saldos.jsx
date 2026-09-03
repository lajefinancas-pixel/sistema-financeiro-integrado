import React from "react";
import {
  Plus, X, Pencil, Save, Trash2, Printer, FileText, FileSpreadsheet, Upload,
  ChevronLeft, ChevronRight, GripVertical, Archive, Eraser, Settings2,
} from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabaseClient";
import { imprimirSaldos, gerarPdfSaldos, agoraBR } from "../lib/saldosDocumento";
import { carregarSaldosDasContas } from "../lib/saldosContasDados";
import { totalizarSaldos } from "../lib/saldosContas";
import { somar } from "../lib/rateioPagamentos";
import Layout from "../components/Layout";
import CampoMoeda from "../components/CampoMoeda";
import { colunasPorCabecalho, formatBRL, marcarColunasDeMoeda, paraNumeroMoeda } from "../lib/moeda";
import { registrarEvento } from "../lib/auditoria";
import { erroAmigavel, mensagemAmigavel } from "../lib/erros";
import { usePermissaoModulo } from "../lib/permissoes";
import { auditarExclusao } from "../lib/exclusaoRegistros";
import ModalConfirmarExclusao from "../components/comuns/ModalConfirmarExclusao";
import PainelFiltros from "../components/comuns/PainelFiltros";
import { campoPreenchido, lancarSaldoDaConta, lancarSaldos, linhasParaLancamento } from "../lib/lancamentoSaldos";
import {
  alteracoesDoCadastro, atualizarContaBancaria, carregarContasDoCadastro, carregarFontesRecurso,
  contaDuplicada, criarContaBancaria, criarFonteRecurso, definirSituacaoConta, mensagemDuplicidade,
  programacoesEmElaboracaoComConta, retratoDasAlteracoes, retratoDoCadastro, saldoInicialInformado,
  tipoContaLabel,
} from "../lib/contasBancarias";
import ModalContaBancaria from "../components/saldos/ModalContaBancaria";
import ModalSituacaoConta from "../components/saldos/ModalSituacaoConta";
import ModalLimparCampos from "../components/saldos/ModalLimparCampos";
import ContasDesativadas from "../components/saldos/ContasDesativadas";

const CORES = ["#2563EB", "#16A34A", "#EA9A1E", "#7C3AED", "#DB2777", "#0EA5E9", "#059669", "#D97706"];
const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];
const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// Banco e Nome da Conta nunca quebram linha. Textos muito longos apenas encolhem
// um pouco a fonte, mantendo a altura das linhas uniforme.
function classeTextoLongo(texto) {
  const n = String(texto ?? "").length;
  if (n > 34) return "text-[11px]";
  if (n > 24) return "text-xs";
  return "";
}
function toISO(d) {
  return d.toISOString().slice(0, 10);
}
function hojeISO() {
  return toISO(new Date());
}
function hojeBR() {
  return new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}
function dataBR(iso) {
  if (!iso) return "--";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR");
}
function gerarDiasDoMes(ano, mes) {
  const primeiroDia = new Date(ano, mes, 1);
  const ultimoDia = new Date(ano, mes + 1, 0);
  const diasAntes = primeiroDia.getDay();
  const dias = [];
  for (let i = 0; i < diasAntes; i++) dias.push(null);
  for (let d = 1; d <= ultimoDia.getDate(); d++) dias.push(d);
  return dias;
}

// Mesma ordem do cabeçalho da planilha, usada para achar a coluna de valor.
const COLUNAS_EXCEL_SALDOS = ["Secretaria", "Banco", "Número da Conta", "Saldo", "Nome da Conta"];

const TABELA_ORDEM = "preferencias_ordem_secretarias";
const CHAVE_ORDEM_LOCAL = "saldos:ordem-secretarias";

// Mantém a ordem escolhida pelo usuário; secretarias novas entram no fim da lista.
function ordenarPorPreferencia(lista, ordem) {
  const posicao = new Map((ordem ?? []).map((id, i) => [id, i]));
  return [...lista].sort(
    (a, b) => (posicao.has(a.id) ? posicao.get(a.id) : 1e9) - (posicao.has(b.id) ? posicao.get(b.id) : 1e9)
  );
}

function montarSecoes(lista) {
  return lista
    .filter((sec) => sec.contas.length > 0)
    .map((sec) => ({
      nome: sec.nome,
      total: sec.total ?? sec.contas.reduce((acc, c) => acc + (c.saldo ?? 0), 0),
      contas: sec.contas.map((c) => ({
        banco: c.banco,
        numero_conta: c.numero_conta,
        saldo: c.saldo,
        nome_conta: c.nome_conta,
      })),
    }));
}

// Saldo em centavos: comparar assim evita registrar "alteração" quando o valor
// digitado é o mesmo de antes, com outra representação decimal.
function centavos(valor) {
  return Math.round(paraNumeroMoeda(valor) * 100);
}

/** Como a conta aparece na trilha de auditoria: "Secretaria — Banco · Conta". */
function rotuloDaConta(conta, secretaria) {
  const identificacao = [conta?.banco, conta?.nome_conta].filter(Boolean).join(" · ");
  const numero = conta?.numero_conta ? ` (${conta.numero_conta})` : "";
  const inicio = secretaria ? `${secretaria} — ` : "";
  return `${inicio}${identificacao || "Conta bancária"}${numero}`;
}

export default function Saldos() {
  const [modoVisualizacao, setModoVisualizacao] = React.useState("atual");

  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [secretarias, setSecretarias] = React.useState([]);
  const [bancos, setBancos] = React.useState([]);
  const [contasPorSecretaria, setContasPorSecretaria] = React.useState([]);

  const [salvando, setSalvando] = React.useState(false);
  const [aviso, setAviso] = React.useState(null);

  // Cadastro de contas: um só formulário para criar e editar, e a situação
  // (ativa/desativada) sempre passando por confirmação.
  const [modalConta, setModalConta] = React.useState(null);
  const [situacaoPendente, setSituacaoPendente] = React.useState(null);
  const [limparPendente, setLimparPendente] = React.useState(null);
  const [contasInativas, setContasInativas] = React.useState([]);
  const [todasAsContas, setTodasAsContas] = React.useState([]);
  // `null` = a estrutura de fonte de recurso ainda não existe neste banco: a
  // tela esconde o campo em vez de mostrar erro.
  const [fontes, setFontes] = React.useState(null);
  const [comFonteRecurso, setComFonteRecurso] = React.useState(false);

  const [mostrarImportar, setMostrarImportar] = React.useState(false);
  const [textoImportar, setTextoImportar] = React.useState("");
  const [importando, setImportando] = React.useState(false);
  const [resultadoImportar, setResultadoImportar] = React.useState(null);

  const [editandoSecretariaId, setEditandoSecretariaId] = React.useState(null);
  const [saldosLote, setSaldosLote] = React.useState({});
  const [dataLote, setDataLote] = React.useState(hojeISO());

  const [editando, setEditando] = React.useState(null);
  const [novoSaldo, setNovoSaldo] = React.useState({ valor: "", data: hojeISO() });

  const hoje = new Date();
  const [mesExibido, setMesExibido] = React.useState(hoje.getMonth());
  const [anoExibido, setAnoExibido] = React.useState(hoje.getFullYear());
  const [dataSelecionada, setDataSelecionada] = React.useState(hojeISO());
  const [datasComSaldo, setDatasComSaldo] = React.useState(new Set());
  const [contasPorSecretariaNaData, setContasPorSecretariaNaData] = React.useState([]);
  const [carregandoHistorico, setCarregandoHistorico] = React.useState(true);

  const [usuarioId, setUsuarioId] = React.useState(null);
  // Exclusão sempre passa pela confirmação padrão: nada é excluído no clique.
  const [exclusaoPendente, setExclusaoPendente] = React.useState(null);
  const { permissao: permissaoSaldos } = usePermissaoModulo("saldos");
  // Matriz de permissões do módulo Saldos: cadastrar / editar conta bancária e
  // desativar-reativar conta bancária. Lançar o saldo do dia segue liberado
  // para quem já usa a tela.
  const podeCadastrar = permissaoSaldos?.pode_cadastrar === true;
  const podeEditarCadastro = permissaoSaldos?.pode_editar === true;
  const podeExcluir = permissaoSaldos?.pode_excluir === true;
  const [ordemSecretarias, setOrdemSecretarias] = React.useState([]);
  const [arrastandoId, setArrastandoId] = React.useState(null);
  const [sobreId, setSobreId] = React.useState(null);
  // Espelho do card em arraste: os eventos de dragover/drop leem o ref, que já está
  // atualizado no mesmo instante do dragstart (o estado serve só para o destaque visual).
  const arrastandoRef = React.useRef(null);
  const refsCards = React.useRef(new Map());

  React.useEffect(() => {
    carregarDados();
    carregarOrdem();
  }, []);

  React.useEffect(() => {
    if (modoVisualizacao === "historico") {
      carregarDatasComSaldo();
    }
  }, [modoVisualizacao, mesExibido, anoExibido]);

  React.useEffect(() => {
    if (modoVisualizacao === "historico") {
      carregarSaldosNaData();
    }
  }, [modoVisualizacao, dataSelecionada]);
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

      // Cadastro inteiro, ativas e desativadas: as ativas montam o painel do
      // dia; as desativadas alimentam a seção "Contas desativadas", que existe
      // justamente para mostrar que o histórico delas continua no banco.
      const { contas, comFonteRecurso: temColunaFonte } = await carregarContasDoCadastro({
        situacao: "todas",
      });
      const fontesRecurso = await carregarFontesRecurso();

      const nomeDaSecretaria = new Map((secs ?? []).map((sec) => [String(sec.id), sec.nome]));
      const nomeDoBanco = new Map((bcs ?? []).map((banco) => [String(banco.id), banco.nome]));
      const nomeDaFonte = new Map((fontesRecurso ?? []).map((fonte) => [String(fonte.id), fonte.nome]));

      const cadastro = (contas ?? []).map((c) => ({
        id: c.id,
        secretaria_id: c.secretaria_id,
        banco_id: c.banco_id,
        secretaria: nomeDaSecretaria.get(String(c.secretaria_id)) ?? null,
        banco: c.bancos?.nome ?? nomeDoBanco.get(String(c.banco_id)) ?? "--",
        nome_conta: c.nome_conta,
        numero_conta: c.numero_conta,
        tipo_conta: c.tipo_conta ?? "",
        fonte_recurso_id: c.fonte_recurso_id ?? null,
        fonte_recurso: nomeDaFonte.get(String(c.fonte_recurso_id)) ?? null,
        ativo: c.ativo !== false,
      }));

      // O Saldo Real de cada conta vem da fonte única (consulta paginada, um
      // registro por conta) -- a mesma usada pelo Painel Principal e por
      // Pagamentos Diários.
      const { contas: contasComSaldo } = await carregarSaldosDasContas({
        contas: cadastro,
        comReservas: false,
      });

      const agrupado = (secs ?? []).map((sec, i) => {
        const contasDaSec = contasComSaldo.filter((c) => c.ativo && c.secretaria_id === sec.id);
        // Cada conta entra no total UMA ÚNICA VEZ, pelo id da conta.
        const total = totalizarSaldos(contasDaSec).saldoReal;
        return { id: sec.id, nome: sec.nome, cor: CORES[i % CORES.length], contas: contasDaSec, total };
      });

      setSecretarias(secs ?? []);
      setBancos(bcs ?? []);
      setFontes(fontesRecurso);
      setComFonteRecurso(temColunaFonte);
      setTodasAsContas(contasComSaldo);
      setContasInativas(
        contasComSaldo
          .filter((c) => !c.ativo)
          .sort((a, b) => `${a.secretaria ?? ""}${a.nome_conta ?? ""}`.localeCompare(`${b.secretaria ?? ""}${b.nome_conta ?? ""}`, "pt-BR")),
      );
      setContasPorSecretaria(agrupado);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Erro ao carregar dados."));
    } finally {
      setCarregando(false);
    }
  }

  // A ordem dos cards fica guardada por usuário no Supabase; o cache local só evita
  // que a tela "pisque" na ordem antiga enquanto a preferência é buscada.
  async function carregarOrdem() {
    try {
      const { data: dadosUsuario } = await supabase.auth.getUser();
      const id = dadosUsuario?.user?.id ?? null;
      setUsuarioId(id);
      if (!id) return;

      const local = localStorage.getItem(`${CHAVE_ORDEM_LOCAL}:${id}`);
      if (local) {
        try {
          const salvo = JSON.parse(local);
          if (Array.isArray(salvo)) setOrdemSecretarias(salvo);
        } catch {
          /* cache inválido: ignora */
        }
      }

      const { data, error } = await supabase
        .from(TABELA_ORDEM)
        .select("ordem")
        .eq("usuario_id", id)
        .maybeSingle();
      if (error) return; // sem preferência salva ainda: mantém a ordem alfabética
      if (Array.isArray(data?.ordem)) setOrdemSecretarias(data.ordem);
    } catch {
      /* a ordenação é um complemento: nunca deve impedir a página de carregar */
    }
  }

  async function salvarOrdem(novaOrdem) {
    setOrdemSecretarias(novaOrdem);
    if (!usuarioId) return;
    try {
      localStorage.setItem(`${CHAVE_ORDEM_LOCAL}:${usuarioId}`, JSON.stringify(novaOrdem));
    } catch {
      /* armazenamento local indisponível: segue apenas com o Supabase */
    }
    const { error } = await supabase
      .from(TABELA_ORDEM)
      .upsert({ usuario_id: usuarioId, ordem: novaOrdem, atualizado_em: new Date().toISOString() },
        { onConflict: "usuario_id" });
    if (error) setErro(mensagemAmigavel(error, "Não foi possível salvar a ordem das secretarias."));
  }

  function reordenar(origemId, destinoId) {
    if (!origemId || !destinoId || origemId === destinoId) return;
    const base = idsOrdenados;
    const de = base.indexOf(origemId);
    const para = base.indexOf(destinoId);
    if (de < 0 || para < 0) return;
    const nova = [...base];
    nova.splice(de, 1);
    nova.splice(para, 0, origemId);
    salvarOrdem(nova);
  }

  function encerrarArraste() {
    arrastandoRef.current = null;
    setArrastandoId(null);
    setSobreId(null);
  }

  // A alça é o único elemento arrastável: o navegador decide isso já no mousedown,
  // então o atributo precisa estar sempre presente (ligar via estado não funciona).
  function propsAlca(secId) {
    return {
      draggable: true,
      onDragStart: (e) => {
        arrastandoRef.current = secId;
        setArrastandoId(secId);
        e.dataTransfer.effectAllowed = "move";
        try {
          e.dataTransfer.setData("text/plain", String(secId));
        } catch {
          /* alguns navegadores bloqueiam setData: o estado local já basta */
        }
        // Mostra o card inteiro como prévia do arraste, e não apenas o ícone da alça.
        const card = refsCards.current.get(secId);
        if (card && typeof e.dataTransfer.setDragImage === "function") {
          e.dataTransfer.setDragImage(card, 24, 20);
        }
      },
      onDragEnd: encerrarArraste,
    };
  }

  // O card inteiro continua sendo alvo de soltura, mesmo sem ser arrastável.
  function propsCard(secId) {
    return {
      ref: (el) => {
        if (el) refsCards.current.set(secId, el);
        else refsCards.current.delete(secId);
      },
      onDragOver: (e) => {
        const origem = arrastandoRef.current;
        if (!origem || origem === secId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (sobreId !== secId) setSobreId(secId);
      },
      onDragLeave: (e) => {
        // Ignora a saída para elementos internos do próprio card (evita piscar o destaque).
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setSobreId((atual) => (atual === secId ? null : atual));
      },
      onDrop: (e) => {
        e.preventDefault();
        reordenar(arrastandoRef.current, secId);
        encerrarArraste();
      },
    };
  }

  async function carregarDatasComSaldo() {
    try {
      const inicio = toISO(new Date(anoExibido, mesExibido, 1));
      const fim = toISO(new Date(anoExibido, mesExibido + 1, 0));
      const { data, error } = await supabase
        .from("saldos_historico")
        .select("data_saldo")
        .gte("data_saldo", inicio)
        .lte("data_saldo", fim);
      if (error) throw error;
      setDatasComSaldo(new Set((data ?? []).map((r) => r.data_saldo)));
    } catch (e) {
      setErro(mensagemAmigavel(e, "Erro ao carregar calendário."));
    }
  }

  async function carregarSaldosNaData() {
    setCarregandoHistorico(true);
    setErro(null);
    try {
      const { data: secs, error: e1 } = await supabase
        .from("secretarias").select("id, nome").eq("ativo", true).order("nome");
      if (e1) throw e1;

      // Sem filtro de ativo: esta visão é consulta de período anterior, e conta
      // desativada continua tendo histórico. Só aparece a conta que realmente
      // tinha saldo lançado até a data (filtro por dataSaldo, mais abaixo).
      const { data: contas, error: e2 } = await supabase
        .from("contas_bancarias")
        .select("id, nome_conta, numero_conta, secretaria_id, bancos(nome)");
      if (e2) throw e2;

      // Mesma fonte única, agora com o saldo limitado à data escolhida.
      const { contas: contasComSaldo } = await carregarSaldosDasContas({
        contas: (contas ?? []).map((c) => ({
          id: c.id,
          secretaria_id: c.secretaria_id,
          banco: c.bancos?.nome ?? "--",
          nome_conta: c.nome_conta,
          numero_conta: c.numero_conta,
        })),
        ate: dataSelecionada,
        comReservas: false,
      });

      const agrupado = (secs ?? []).map((sec, i) => {
        const contasDaSec = contasComSaldo
          // Sem lançamento até a data escolhida, a conta não aparece na visão histórica.
          .filter((c) => c.secretaria_id === sec.id && c.dataSaldo !== null)
          .map((c) => ({ ...c, dataDoSaldo: c.dataSaldo }));
        const total = totalizarSaldos(contasDaSec).saldoReal;
        return { id: sec.id, nome: sec.nome, cor: CORES[i % CORES.length], contas: contasDaSec, total };
      }).filter((sec) => sec.contas.length > 0);

      setContasPorSecretariaNaData(agrupado);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Erro ao carregar saldos da data."));
    } finally {
      setCarregandoHistorico(false);
    }
  }

  function mudarMes(delta) {
    let novoMes = mesExibido + delta;
    let novoAno = anoExibido;
    if (novoMes < 0) { novoMes = 11; novoAno--; }
    if (novoMes > 11) { novoMes = 0; novoAno++; }
    setMesExibido(novoMes);
    setAnoExibido(novoAno);
  }
  /**
   * Abre o lançamento do dia com os campos EM BRANCO.
   *
   * Só vem preenchido o que já foi lançado na própria data escolhida — aí o
   * valor na tela é o registro daquele dia, e conferir/corrigir faz sentido.
   * Nos demais casos o campo fica vazio, pronto para digitar: repetir o valor
   * do último lançamento obrigava a apagar dezenas de campos todas as manhãs.
   *
   * O último saldo conhecido não se perde de vista: ele aparece como referência
   * discreta embaixo do campo.
   */
  function camposDoLote(sec, data) {
    const inicial = {};
    sec.contas.forEach((c) => {
      const dataDoSaldo = c.dataSaldo ?? c.dataDoSaldo ?? null;
      inicial[c.id] = dataDoSaldo === data ? (c.saldo ?? "") : "";
    });
    return inicial;
  }

  function iniciarEdicaoLote(sec) {
    const data = hojeISO();
    setSaldosLote(camposDoLote(sec, data));
    setDataLote(data);
    setEditandoSecretariaId(sec.id);
  }

  /** Trocar a data do lançamento refaz a referência: cada dia tem o seu registro. */
  function mudarDataLote(sec, data) {
    setDataLote(data);
    setSaldosLote(camposDoLote(sec, data));
  }

  /**
   * LIMPAR CAMPOS — ação exclusivamente visual.
   *
   * Esvazia os campos de saldo na tela e nada mais: nenhum delete, nenhum
   * update, nenhum insert em saldos_historico. Saindo daqui sem salvar, os
   * saldos anteriores continuam exatamente como estavam. Só o que for digitado
   * e salvo depois chega ao banco, pela rotina normal de lançamento.
   */
  function limparCamposLote() {
    setSaldosLote((atual) => {
      const vazios = {};
      Object.keys(atual).forEach((contaId) => {
        vazios[contaId] = "";
      });
      return vazios;
    });
    setLimparPendente(null);
    setAviso("Campos limpos na tela. Nenhum saldo foi apagado do banco.");
  }

  /** Quantos campos têm valor digitado agora (texto do modal de confirmação). */
  function camposPreenchidosNoLote() {
    return Object.values(saldosLote).filter((valor) => campoPreenchido(valor)).length;
  }

  /**
   * Conta (com o saldo que está na tela) e a secretaria dela — é a base do
   * "antes" que a trilha de auditoria registra nas mudanças de saldo.
   */
  function localizarConta(contaId) {
    for (const sec of contasPorSecretaria) {
      const conta = (sec.contas ?? []).find((c) => String(c.id) === String(contaId));
      if (conta) return { conta, secretaria: sec.nome };
    }
    return { conta: null, secretaria: null };
  }

  /**
   * Auditoria de saldo: mudança de dinheiro em conta é sempre evento crítico.
   * Auditar nunca derruba o salvamento — `registrarEvento` trata os próprios
   * erros e a tela segue exatamente como antes.
   */
  async function auditarSaldo({ conta, secretaria, valorNovo, dataNova }) {
    await registrarEvento({
      modulo: "saldos",
      acao: "alterou",
      registroAfetado: rotuloDaConta(conta, secretaria),
      valorAnterior: {
        saldo: formatBRL(paraNumeroMoeda(conta?.saldo ?? 0)),
        data_saldo: conta?.dataSaldo ?? conta?.dataDoSaldo ?? null,
      },
      valorNovo: {
        saldo: formatBRL(paraNumeroMoeda(valorNovo)),
        data_saldo: dataNova ?? null,
      },
      nivel: "critico",
    });
  }

  async function salvarLote(sec) {
    setSalvando(true);
    setErro(null);
    try {
      // Campo em branco não é zero: entra no lançamento só a conta que teve
      // valor digitado. As demais ficam intocadas no banco.
      const linhas = linhasParaLancamento({ contas: sec.contas, valores: saldosLote, data: dataLote });
      if (linhas.length === 0) {
        throw erroAmigavel("Digite o saldo de pelo menos uma conta para salvar o lançamento do dia.");
      }
      await lancarSaldos(linhas);

      // Auditoria: um evento por conta lançada que realmente mudou de valor ou
      // de data.
      const lancadas = new Set(linhas.map((linha) => String(linha.conta_id)));
      const alteradas = sec.contas.filter(
        (c) =>
          lancadas.has(String(c.id)) &&
          (centavos(saldosLote[c.id]) !== centavos(c.saldo) ||
            (c.dataSaldo ?? c.dataDoSaldo ?? null) !== dataLote),
      );
      for (const conta of alteradas) {
        await auditarSaldo({
          conta,
          secretaria: sec.nome,
          valorNovo: saldosLote[conta.id],
          dataNova: dataLote,
        });
      }

      setEditandoSecretariaId(null);
      setSaldosLote({});
      setAviso(
        `${linhas.length} ${linhas.length === 1 ? "saldo lançado" : "saldos lançados"} em ${sec.nome}.`,
      );
      await carregarDados();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Erro ao salvar saldos em lote."));
    } finally {
      setSalvando(false);
    }
  }

  // -------------------------------------------------------------------------
  // Cadastro da conta bancária
  //
  // Criar, editar e mudar a situação (ativa / desativada). O saldo NUNCA é
  // gravado por aqui: quando há saldo inicial, quem grava é `lancarSaldoDaConta`
  // — a mesma rotina do lançamento diário.
  // -------------------------------------------------------------------------

  function abrirNovaConta() {
    setErro(null);
    setAviso(null);
    setModalConta({ modo: "novo", conta: null });
  }

  function abrirEdicaoConta(contaId) {
    const conta = todasAsContas.find((c) => String(c.id) === String(contaId));
    if (!conta) return;
    setErro(null);
    setAviso(null);
    setModalConta({ modo: "editar", conta });
  }

  /** Secretaria escolhida no formulário, criando-a quando for nova. */
  async function resolverSecretaria(dados) {
    if (!dados.nova_secretaria) return { id: dados.secretaria_id, nome: nomeDaSecretariaSalva(dados.secretaria_id) };
    const nome = String(dados.secretaria_novo_nome).trim();
    const { data, error } = await supabase.from("secretarias").insert({ nome }).select("id, nome").single();
    if (error) throw error;
    return { id: data.id, nome: data.nome };
  }

  async function resolverBanco(dados) {
    if (!dados.novo_banco) return { id: dados.banco_id, nome: nomeDoBancoSalvo(dados.banco_id) };
    const nome = String(dados.banco_novo_nome).trim();
    const { data, error } = await supabase.from("bancos").insert({ nome }).select("id, nome").single();
    if (error) throw error;
    return { id: data.id, nome: data.nome };
  }

  /** Fonte de recurso: opcional, e inexistente enquanto a migration não roda. */
  async function resolverFonte(dados) {
    if (!comFonteRecurso || fontes === null) return { id: null, nome: null };
    if (!dados.nova_fonte) {
      const escolhida = (fontes ?? []).find((f) => String(f.id) === String(dados.fonte_recurso_id));
      return { id: dados.fonte_recurso_id || null, nome: escolhida?.nome ?? null };
    }
    const nome = String(dados.fonte_novo_nome).trim();
    if (!nome) return { id: null, nome: null };
    const criada = await criarFonteRecurso(nome);
    return { id: criada.id, nome: criada.nome };
  }

  function nomeDaSecretariaSalva(id) {
    return secretarias.find((sec) => String(sec.id) === String(id))?.nome ?? null;
  }

  function nomeDoBancoSalvo(id) {
    return bancos.find((banco) => String(banco.id) === String(id))?.nome ?? null;
  }

  /**
   * Salva o cadastro — criação e edição no mesmo caminho.
   *
   * Na edição nada de saldo é tocado: só as colunas de cadastro de
   * contas_bancarias mudam, e a auditoria recebe campo a campo o valor anterior
   * e o novo.
   */
  async function salvarConta(dados) {
    const edicao = modalConta?.modo === "editar";
    const contaAtual = modalConta?.conta ?? null;

    const secretaria = await resolverSecretaria(dados);
    const banco = await resolverBanco(dados);

    // Duas contas não podem ter o mesmo número no mesmo banco e na mesma
    // secretaria — inclusive contra as desativadas, que nesse caso a mensagem
    // manda reativar em vez de duplicar.
    const conflito = contaDuplicada({
      contas: todasAsContas,
      secretariaId: secretaria.id,
      bancoId: banco.id,
      numeroConta: dados.numero_conta,
      ignorarId: edicao ? contaAtual?.id : null,
    });
    if (conflito) throw erroAmigavel(mensagemDuplicidade(conflito));

    const fonte = await resolverFonte(dados);
    const payload = {
      secretariaId: secretaria.id,
      bancoId: banco.id,
      nomeConta: dados.nome_conta,
      numeroConta: dados.numero_conta,
      tipoConta: dados.tipo_conta,
      fonteRecursoId: fonte.id,
    };

    const depois = {
      secretaria: secretaria.nome,
      banco: banco.nome,
      numero_conta: String(dados.numero_conta).trim(),
      nome_conta: String(dados.nome_conta).trim(),
      tipo_conta: dados.tipo_conta,
      fonte_recurso: fonte.nome,
    };

    if (edicao) {
      const antes = {
        secretaria: contaAtual.secretaria,
        banco: contaAtual.banco,
        numero_conta: contaAtual.numero_conta,
        nome_conta: contaAtual.nome_conta,
        tipo_conta: contaAtual.tipo_conta,
        fonte_recurso: contaAtual.fonte_recurso,
      };
      const { alterados, houveMudanca, resumo } = alteracoesDoCadastro(antes, depois);
      if (!houveMudanca) {
        setModalConta(null);
        setAviso("Nenhum campo do cadastro foi alterado.");
        return;
      }

      await atualizarContaBancaria(contaAtual.id, payload, { comFonteRecurso });

      const { anterior, novo } = retratoDasAlteracoes(alterados);
      await registrarEvento({
        modulo: "saldos",
        acao: "alterou",
        registroAfetado: rotuloDaConta(contaAtual, contaAtual.secretaria),
        valorAnterior: anterior,
        valorNovo: novo,
        // Edição de cadastro não move dinheiro: nenhum saldo e nenhum histórico
        // é alterado por aqui.
        nivel: "atencao",
      });

      setModalConta(null);
      setAviso(`Cadastro atualizado (${resumo}). Nenhum saldo lançado foi alterado.`);
      await carregarDados();
      return;
    }

    const criada = await criarContaBancaria(payload, { comFonteRecurso });

    // Saldo inicial é opcional. Informado, vai para saldos_historico na data do
    // cadastro pela MESMA rotina do lançamento diário. Em branco, a conta nasce
    // sem saldo e recebe o primeiro lançamento normalmente.
    const comSaldoInicial = saldoInicialInformado(dados.saldo_inicial);
    if (comSaldoInicial) {
      await lancarSaldoDaConta({
        contaId: criada.id,
        valor: dados.saldo_inicial,
        data: dados.data_saldo,
      });
    }

    await registrarEvento({
      modulo: "saldos",
      acao: "criou",
      registroAfetado: rotuloDaConta(
        { banco: banco.nome, nome_conta: depois.nome_conta, numero_conta: depois.numero_conta },
        secretaria.nome,
      ),
      valorNovo: {
        ...retratoDoCadastro(depois),
        ...(comSaldoInicial
          ? {
              saldo_inicial: formatBRL(paraNumeroMoeda(dados.saldo_inicial)),
              data_saldo: dados.data_saldo,
            }
          : { saldo_inicial: "Não informado" }),
      },
      // Conta que já nasce com saldo mexe com dinheiro: evento crítico.
      nivel: comSaldoInicial ? "critico" : "atencao",
    });

    setModalConta(null);
    setAviso(
      comSaldoInicial
        ? `Conta ${depois.nome_conta} cadastrada com saldo inicial lançado em ${dataBR(dados.data_saldo)}.`
        : `Conta ${depois.nome_conta} cadastrada. Lance o saldo dela no próximo lançamento do dia.`,
    );
    await carregarDados();
  }

  /**
   * Abre a confirmação de desativação ou reativação da conta.
   *
   * Desativar não é excluir: a conta sai das telas de uso corrente (entre elas
   * a seleção de contas da Programação Diária) e todo o histórico de saldos e
   * as movimentações passadas continuam no banco. Não existe exclusão
   * definitiva de conta bancária.
   */
  async function abrirSituacaoConta(contaId, destino) {
    const conta = todasAsContas.find((c) => String(c.id) === String(contaId));
    if (!conta) return;
    setErro(null);
    setAviso(null);

    const rotulo = rotuloDaConta(conta, conta.secretaria);
    const dataDoSaldo = conta.dataSaldo ?? conta.dataDoSaldo ?? null;
    setSituacaoPendente({
      conta: { ...conta, rotulo },
      destino,
      verificando: destino === "desativar",
      programacoes: [],
      detalhes: [
        { rotulo: "Secretaria", valor: conta.secretaria ?? "--" },
        { rotulo: "Banco", valor: conta.banco ?? "--" },
        { rotulo: "Número da conta", valor: conta.numero_conta || "--" },
        { rotulo: "Tipo de conta", valor: tipoContaLabel(conta.tipo_conta) },
        {
          rotulo: "Último saldo lançado",
          valor: dataDoSaldo
            ? `${formatBRL(paraNumeroMoeda(conta.saldo ?? 0))} em ${dataBR(dataDoSaldo)}`
            : "Sem lançamento",
        },
      ],
    });

    if (destino !== "desativar") return;

    // Aviso antes de confirmar: a conta pode estar escolhida em alguma
    // programação ainda em elaboração.
    try {
      const programacoes = await programacoesEmElaboracaoComConta(conta.id);
      setSituacaoPendente((atual) =>
        atual && String(atual.conta.id) === String(conta.id)
          ? { ...atual, programacoes, verificando: false }
          : atual,
      );
    } catch {
      // Não conseguir conferir não impede a desativação: o aviso é um extra.
      setSituacaoPendente((atual) =>
        atual && String(atual.conta.id) === String(conta.id) ? { ...atual, verificando: false } : atual,
      );
    }
  }

  async function confirmarSituacao(motivo) {
    const pendente = situacaoPendente;
    if (!pendente) return;
    const desativando = pendente.destino === "desativar";
    const conta = pendente.conta;
    const dataDoSaldo = conta.dataSaldo ?? conta.dataDoSaldo ?? null;

    await definirSituacaoConta(conta.id, !desativando);

    await registrarEvento({
      modulo: "saldos",
      acao: desativando ? "desativou_conta" : "reativou_conta",
      registroAfetado: conta.rotulo,
      valorAnterior: { situacao: desativando ? "Ativa" : "Desativada" },
      valorNovo: {
        situacao: desativando ? "Desativada" : "Ativa",
        saldo: formatBRL(paraNumeroMoeda(conta.saldo ?? 0)),
        data_saldo: dataDoSaldo,
        // Deixa registrado na trilha que nada foi apagado.
        historico_saldos: "Preservado integralmente",
        ...(desativando && pendente.programacoes.length > 0
          ? { programacoes_em_elaboracao: pendente.programacoes.length }
          : {}),
        ...(motivo ? { motivo_desativacao: motivo } : {}),
      },
      nivel: "critico",
    });

    setSituacaoPendente(null);
    setAviso(
      desativando
        ? "Conta desativada. O histórico de saldos dela continua disponível em Histórico, Relatórios e Auditoria."
        : "Conta reativada com todo o histórico que já tinha.",
    );
    await carregarDados();
  }

  function excluirSecretaria(secretariaId, nome) {
    const secretaria = contasPorSecretaria.find((s) => String(s.id) === String(secretariaId));
    const quantidade = secretaria?.contas?.length ?? 0;
    setExclusaoPendente({
      id: secretariaId,
      rotulo: nome,
      registro: `a secretaria ${nome}`,
      aviso: "As contas cadastradas nela deixarão de aparecer no painel.",
      exigirMotivo: false,
      detalhes: [
        { rotulo: "Secretaria", valor: nome },
        { rotulo: "Contas cadastradas", valor: String(quantidade) },
        { rotulo: "Saldo somado", valor: formatBRL(paraNumeroMoeda(secretaria?.total ?? 0)) },
      ],
      anterior: { secretaria: nome, contas: String(quantidade) },
    });
  }

  /**
   * Executa a exclusão confirmada no modal e registra o evento na auditoria.
   * Vale apenas para secretaria: em Saldos a exclusão continua sendo a
   * inativação de sempre (ativo = false). Conta bancária não passa por aqui —
   * ela tem o próprio fluxo de desativar/reativar, sem exclusão definitiva.
   */
  async function confirmarExclusao(motivo) {
    const pendente = exclusaoPendente;
    if (!pendente) return;
    setErro(null);

    const { error } = await supabase.from("secretarias").update({ ativo: false }).eq("id", pendente.id);
    if (error) throw error;

    await auditarExclusao({
      modulo: "saldos",
      registroAfetado: pendente.rotulo,
      motivo,
      valorAnterior: pendente.anterior,
      logica: false,
      nivel: "atencao",
    });

    setExclusaoPendente(null);
    await carregarDados();
  }

  async function salvarNovoSaldo(contaId) {
    setSalvando(true);
    setErro(null);
    try {
      // Sem valor digitado não há o que lançar: o campo em branco nunca vira
      // R$ 0,00 no banco.
      if (!campoPreenchido(novoSaldo.valor)) {
        throw erroAmigavel("Digite o novo saldo desta conta.");
      }
      const valor = paraNumeroMoeda(novoSaldo.valor);
      await lancarSaldoDaConta({ contaId, valor, data: novoSaldo.data });

      // Auditoria: lançamento de saldo é evento crítico.
      const { conta, secretaria } = localizarConta(contaId);
      await auditarSaldo({ conta, secretaria, valorNovo: valor, dataNova: novoSaldo.data });

      setEditando(null);
      setNovoSaldo({ valor: "", data: hojeISO() });
      await carregarDados();
    } catch (e) {
      setErro(mensagemAmigavel(e, "Erro ao atualizar saldo."));
    } finally {
      setSalvando(false);
    }
  }

  function exportarExcel() {
    const fonte = modoVisualizacao === "historico" ? secretariasHistorico : secretariasAtual;
    const linhas = [];
    fonte.forEach((sec) => {
      sec.contas.forEach((c) => {
        // Ordem fixa das colunas: Banco | Número da Conta | Saldo | Nome da Conta
        linhas.push({
          Secretaria: sec.nome,
          Banco: c.banco,
          "Número da Conta": c.numero_conta,
          Saldo: c.saldo,
          "Nome da Conta": c.nome_conta,
        });
      });
    });
    const ws = XLSX.utils.json_to_sheet(linhas, {
      header: ["Secretaria", "Banco", "Número da Conta", "Saldo", "Nome da Conta"],
    });
    // Saldo sai como número com formato de moeda brasileiro na célula: some na
    // planilha e ainda é lido como "R$ 1.234,56" por quem abre o arquivo.
    marcarColunasDeMoeda(ws, colunasPorCabecalho(COLUNAS_EXCEL_SALDOS, ["Saldo"]), {
      ultimaLinha: linhas.length,
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Saldos");
    XLSX.writeFile(wb, `saldos-${modoVisualizacao === "historico" ? dataSelecionada : hojeISO()}.xlsx`);
  }

  function tituloDocumento() {
    return modoVisualizacao === "historico"
      ? `Saldos das Contas — ${dataSelecionadaBR}`
      : "Saldos das Contas";
  }

  function imprimirGeral() {
    const fonte = modoVisualizacao === "historico" ? secretariasHistorico : secretariasAtual;
    const secoes = montarSecoes(fonte);
    if (secoes.length === 0) {
      setErro("Não há contas com saldo para imprimir.");
      return;
    }
    imprimirSaldos({
      titulo: tituloDocumento(),
      subtitulo: `Emitido em ${agoraBR()}`,
      secoes,
      maxPaginas: 2,
    });
  }

  function gerarPdfGeral() {
    const fonte = modoVisualizacao === "historico" ? secretariasHistorico : secretariasAtual;
    const secoes = montarSecoes(fonte);
    if (secoes.length === 0) {
      setErro("Não há contas com saldo para gerar o PDF.");
      return;
    }
    gerarPdfSaldos({
      titulo: tituloDocumento(),
      subtitulo: `Emitido em ${agoraBR()}`,
      secoes,
      arquivo: `saldos-${modoVisualizacao === "historico" ? dataSelecionada : hojeISO()}.pdf`,
      maxPaginas: 2,
    });
  }

  function imprimirSecretaria(sec) {
    imprimirSaldos({
      titulo: sec.nome,
      subtitulo: `Emitido em ${agoraBR()}`,
      secoes: montarSecoes([sec]),
      maxPaginas: 1,
    });
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

          // Mesma rotina de lançamento das demais telas: o saldo da linha só é
          // gravado quando ela realmente traz um valor.
          if (campoPreenchido(saldoStr)) {
            await lancarSaldoDaConta({ contaId: contaData.id, valor: saldoStr, data: hojeISO() });
          }

          criadas++;
        } catch (e) {
          erros.push(`Linha "${linha}": ${mensagemAmigavel(e, "não foi possível importar esta linha.")}`);
        }
      }

      setResultadoImportar({ criadas, erros });
      if (criadas > 0) {
        // Auditoria: a importação em lote entra como um único evento crítico,
        // com o total de contas criadas (cada linha já traz um saldo).
        await registrarEvento({
          modulo: "saldos",
          acao: "criou",
          registroAfetado: `Importação em lote — ${criadas} ${criadas === 1 ? "conta" : "contas"}`,
          valorNovo: {
            contas_criadas: criadas,
            linhas_com_erro: erros.length,
            data_saldo: hojeISO(),
          },
          nivel: "critico",
        });

        setTextoImportar("");
        await carregarDados();
      }
    } catch (e) {
      setErro(mensagemAmigavel(e, "Erro ao importar."));
    } finally {
      setImportando(false);
    }
  }

  const dias = gerarDiasDoMes(anoExibido, mesExibido);
  const dataSelecionadaBR = new Date(dataSelecionada + "T00:00:00").toLocaleDateString("pt-BR", {
    day: "2-digit", month: "long", year: "numeric",
  });
  // Mesma data em formato curto, para caber no chip da barra de filtros.
  const dataSelecionadaCurtaBR = new Date(dataSelecionada + "T00:00:00").toLocaleDateString("pt-BR");
  const totalGeralHistorico = somar(contasPorSecretariaNaData.map((s) => s.total));

  const secretariasAtual = React.useMemo(
    () => ordenarPorPreferencia(contasPorSecretaria, ordemSecretarias),
    [contasPorSecretaria, ordemSecretarias]
  );
  const secretariasHistorico = React.useMemo(
    () => ordenarPorPreferencia(contasPorSecretariaNaData, ordemSecretarias),
    [contasPorSecretariaNaData, ordemSecretarias]
  );
  // Ordem completa (inclusive secretarias sem saldo na data escolhida), usada ao arrastar.
  const idsOrdenados = React.useMemo(() => {
    const vistos = new Set();
    const lista = [];
    [...secretariasAtual, ...secretariasHistorico].forEach((sec) => {
      if (!vistos.has(sec.id)) {
        vistos.add(sec.id);
        lista.push(sec.id);
      }
    });
    return lista;
  }, [secretariasAtual, secretariasHistorico]);

  return (
    <Layout>
      <div className="px-8 py-7 print:px-0 print:py-0">
        <div className="pl-3 border-l-2 border-[#0F2A44]/10 mb-4 print:hidden">
          <span className="text-xs text-[#0F2A44]/50">Saldo emitido em</span>
          <div className="text-sm font-medium text-[#0F2A44]">{hojeBR()}</div>
        </div>

        <div className="flex items-start justify-between mb-4 print:mb-4">
          <h1 className="text-2xl font-semibold text-[#0F2A44]">Saldos das Contas</h1>
          <div className="flex items-center gap-2 print:hidden">
            <button onClick={imprimirGeral} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5">
              <Printer size={14} /> Imprimir
            </button>
            <button onClick={gerarPdfGeral} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5">
              <FileText size={14} /> PDF
            </button>
            <button onClick={exportarExcel} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5">
              <FileSpreadsheet size={14} /> Excel
            </button>
            {modoVisualizacao === "atual" && (
              <>
                <button
                  onClick={() => setMostrarImportar((v) => !v)}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
                >
                  <Upload size={14} /> Importar em lote
                </button>
                {podeCadastrar && (
                  <button
                    onClick={abrirNovaConta}
                    className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90"
                  >
                    <Plus size={16} /> Nova Conta
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 mb-6 print:hidden bg-black/[0.03] rounded-lg p-1 w-fit">
          <button
            onClick={() => setModoVisualizacao("atual")}
            className={`px-4 py-2 rounded-md text-sm font-medium ${
              modoVisualizacao === "atual" ? "bg-white text-[#0F2A44] shadow-sm" : "text-[#0F2A44]/50"
            }`}
          >
            Saldo Atual
          </button>
          <button
            onClick={() => setModoVisualizacao("historico")}
            className={`px-4 py-2 rounded-md text-sm font-medium ${
              modoVisualizacao === "historico" ? "bg-white text-[#0F2A44] shadow-sm" : "text-[#0F2A44]/50"
            }`}
          >
            Histórico por Data
          </button>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-5 print:hidden">
            {erro}
          </div>
        )}
        {aviso && (
          <div className="flex items-start justify-between gap-3 bg-[#EAFBF0] border border-[#16A34A]/25 text-[#15803D] text-sm rounded-lg px-4 py-3 mb-5 print:hidden">
            <span>{aviso}</span>
            <button onClick={() => setAviso(null)} className="text-[#15803D]/60 hover:text-[#15803D]">
              <X size={14} />
            </button>
          </div>
        )}
        {modoVisualizacao === "atual" && mostrarImportar && (
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
              placeholder={"Secretaria de Finanças;Banco do Brasil;2.042-7;PREFEITURA;1000"}
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

        {modoVisualizacao === "atual" && (
          carregando ? (
            <div className="text-sm text-[#0F2A44]/50">Carregando...</div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-[#0F2A44]/45 print:hidden">
                Arraste os cards pela alça <GripVertical size={11} className="inline align-[-2px]" /> para definir a
                ordem das secretarias. A ordem fica salva na sua conta.
              </p>
              {secretariasAtual.map((sec) => {
                const emLote = editandoSecretariaId === sec.id;
                return (
                  <div
                    key={sec.id}
                    {...propsCard(sec.id)}
                    className={`rounded-xl border overflow-hidden bg-white transition-shadow print:break-inside-avoid ${
                      arrastandoId === sec.id ? "opacity-50" : ""
                    } ${sobreId === sec.id ? "border-[#C9A227] shadow-md" : "border-black/5"}`}
                  >
                    <div
                      className="flex items-center justify-between px-4 py-2.5"
                      style={{ backgroundColor: `${sec.cor}14`, borderLeft: `4px solid ${sec.cor}` }}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: sec.cor }}>
                        <span
                          {...propsAlca(sec.id)}
                          className="cursor-grab active:cursor-grabbing text-[#0F2A44]/25 hover:text-[#0F2A44]/60 print:hidden"
                          title="Arraste para reordenar as secretarias"
                        >
                          <GripVertical size={15} />
                        </span>
                        {sec.nome.toUpperCase()}
                      </span>
                      {/* A secretaria é só o agrupador visual das contas: o cabeçalho
                          não exibe subtotal. O total continua sendo calculado para a
                          impressão, o PDF e a planilha. */}
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-3 print:hidden">
                        {emLote ? (
                          <>
                            <input
                              type="date"
                              value={dataLote}
                              onChange={(e) => mudarDataLote(sec, e.target.value)}
                              className="px-2 py-1 rounded border border-black/10 text-xs"
                            />
                            <button
                              onClick={() => setLimparPendente({ secretariaId: sec.id })}
                              className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
                              title="Esvaziar os campos de saldo desta secretaria (só na tela)"
                            >
                              <Eraser size={12} /> Limpar campos
                            </button>
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
                              <>
                                <button
                                  onClick={() => imprimirSecretaria(sec)}
                                  className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-black/10"
                                  style={{ color: sec.cor }}
                                  title={`Imprimir apenas ${sec.nome}`}
                                >
                                  <Printer size={12} /> Imprimir
                                </button>
                                <button
                                  onClick={() => iniciarEdicaoLote(sec)}
                                  className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-black/10"
                                  style={{ color: sec.cor }}
                                  title="Editar todos os saldos desta secretaria"
                                >
                                  <Pencil size={12} /> Editar saldos
                                </button>
                              </>
                            )}
                            {podeExcluir && (
                              <button
                                onClick={() => excluirSecretaria(sec.id, sec.nome)}
                                className="text-[#0F2A44]/30 hover:text-red-500"
                                title="Excluir secretaria"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </>
                        )}
                        </div>
                      </div>
                    </div>

                    {sec.contas.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-[#0F2A44]/40">
                        Nenhuma conta cadastrada nesta secretaria.
                      </div>
                    ) : (
                      <div className="overflow-x-auto print:overflow-visible">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/40">
                            <th className="px-4 py-2 font-medium whitespace-nowrap">Banco</th>
                            <th className="px-4 py-2 font-medium whitespace-nowrap">Número da Conta</th>
                            <th className="px-4 py-2 font-medium text-center whitespace-nowrap">Saldo</th>
                            <th className="px-4 py-2 font-medium whitespace-nowrap">Nome da Conta</th>
                            <th className="px-4 py-2 font-medium text-right whitespace-nowrap print:hidden">Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sec.contas.map((c) => (
                            <tr key={c.id} className="border-t border-black/5">
                              <td className={`px-4 py-2.5 whitespace-nowrap ${classeTextoLongo(c.banco)}`}>{c.banco}</td>
                              <td className="px-4 py-2.5 whitespace-nowrap text-[#0F2A44]/60">{c.numero_conta || "--"}</td>
                              <td className="px-4 py-2.5 text-center whitespace-nowrap tabular-nums font-bold">
                                {emLote ? (
                                  <div className="flex flex-col items-center gap-0.5">
                                    <CampoMoeda
                                      placeholder="R$ 0,00"
                                      valor={saldosLote[c.id] ?? ""}
                                      onValorChange={(numero, texto) =>
                                        // Campo esvaziado volta a ser "em branco", não zero:
                                        // sem valor digitado, nada é gravado no banco.
                                        setSaldosLote((atual) => ({ ...atual, [c.id]: texto === "" ? "" : numero }))
                                      }
                                      className="w-28 px-2 py-1 rounded border border-black/10 text-xs text-center"
                                    />
                                    {/* Referência discreta: o último saldo conhecido continua
                                        à vista mesmo com o campo em branco. */}
                                    <span className="text-[10px] font-normal text-[#0F2A44]/40 whitespace-nowrap">
                                      {c.dataSaldo
                                        ? `Último: ${formatBRL(c.saldo)} · ${dataBR(c.dataSaldo)}`
                                        : "Sem lançamento anterior"}
                                    </span>
                                  </div>
                                ) : editando === c.id ? (
                                  <div className="flex items-center justify-center gap-2">
                                    <input
                                      type="date"
                                      value={novoSaldo.data}
                                      onChange={(e) => setNovoSaldo({ ...novoSaldo, data: e.target.value })}
                                      className="px-2 py-1 rounded border border-black/10 text-xs"
                                    />
                                    <CampoMoeda
                                      placeholder="R$ 0,00"
                                      valor={novoSaldo.valor}
                                      onValorChange={(numero) => setNovoSaldo((atual) => ({ ...atual, valor: numero }))}
                                      className="w-24 px-2 py-1 rounded border border-black/10 text-xs text-center"
                                    />
                                  </div>
                                ) : (
                                  formatBRL(c.saldo)
                                )}
                              </td>
                              <td className={`px-4 py-2.5 whitespace-nowrap ${classeTextoLongo(c.nome_conta)}`}>{c.nome_conta}</td>
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
                                          onClick={() => { setEditando(c.id); setNovoSaldo({ valor: "", data: hojeISO() }); }}
                                          className="text-[#0F2A44]/50 hover:text-[#0F2A44]"
                                          title="Lançar novo saldo"
                                        >
                                          <Pencil size={15} />
                                        </button>
                                        {podeEditarCadastro && (
                                          <button
                                            onClick={() => abrirEdicaoConta(c.id)}
                                            className="text-[#0F2A44]/40 hover:text-[#0F2A44]"
                                            title="Editar cadastro da conta (não altera saldos)"
                                          >
                                            <Settings2 size={15} />
                                          </button>
                                        )}
                                        {podeExcluir && (
                                          <button
                                            onClick={() => abrirSituacaoConta(c.id, "desativar")}
                                            className="text-[#0F2A44]/30 hover:text-[#B45309]"
                                            title="Desativar conta (o histórico é preservado)"
                                          >
                                            <Archive size={15} />
                                          </button>
                                        )}
                                      </>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    )}
                  </div>
                );
              })}

              <ContasDesativadas
                contas={contasInativas}
                podeReativar={podeExcluir}
                onReativar={(conta) => abrirSituacaoConta(conta.id, "reativar")}
              />
            </div>
          )
        )}
        {modoVisualizacao === "historico" && (
          <div className="print:block">
            {/* O calendário é o filtro desta visão: fica recolhido ao abrir a
                tela e o dia escolhido continua à vista no chip da barra. */}
            <PainelFiltros
              className="mb-6"
              chips={[{ chave: "data", rotulo: `Data: ${dataSelecionadaCurtaBR}` }]}
              onLimpar={dataSelecionada === hojeISO() ? undefined : () => setDataSelecionada(hojeISO())}
            >
              <div className="w-full sm:w-[280px]">
                <div className="flex items-center justify-between mb-3">
                  <button onClick={() => mudarMes(-1)} className="text-[#0F2A44]/50 hover:text-[#0F2A44]">
                    <ChevronLeft size={18} />
                  </button>
                  <span className="text-sm font-semibold text-[#0F2A44]">
                    {MESES[mesExibido]} {anoExibido}
                  </span>
                  <button onClick={() => mudarMes(1)} className="text-[#0F2A44]/50 hover:text-[#0F2A44]">
                    <ChevronRight size={18} />
                  </button>
                </div>

                <div className="grid grid-cols-7 gap-1 mb-1">
                  {DIAS_SEMANA.map((d, i) => (
                    <div key={i} className="text-center text-[10px] font-medium text-[#0F2A44]/40 py-1">
                      {d}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {dias.map((dia, i) => {
                    if (dia === null) return <div key={i} />;
                    const iso = toISO(new Date(anoExibido, mesExibido, dia));
                    const temSaldo = datasComSaldo.has(iso);
                    const selecionado = iso === dataSelecionada;
                    return (
                      <button
                        key={i}
                        onClick={() => setDataSelecionada(iso)}
                        className={`relative aspect-square rounded-lg text-xs flex items-center justify-center ${
                          selecionado
                            ? "bg-[#0F2A44] text-white font-semibold"
                            : temSaldo
                            ? "text-[#0F2A44] font-medium hover:bg-black/5"
                            : "text-[#0F2A44]/30 hover:bg-black/5"
                        }`}
                      >
                        {dia}
                        {temSaldo && !selecionado && (
                          <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-[#C9A227]" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={() => setDataSelecionada(hojeISO())}
                  className="w-full mt-3 text-xs text-center py-2 rounded-lg border border-black/10 text-[#0F2A44]/60 hover:bg-black/5"
                >
                  Ir para hoje
                </button>
              </div>
            </PainelFiltros>

            <div>
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-[#0F2A44] capitalize">{dataSelecionadaBR}</h2>
                <p className="text-sm text-[#0F2A44]/60">
                  Total geral: <span className="font-semibold">{formatBRL(totalGeralHistorico)}</span>
                </p>
              </div>

              {carregandoHistorico ? (
                <div className="text-sm text-[#0F2A44]/50">Carregando...</div>
              ) : contasPorSecretariaNaData.length === 0 ? (
                <div className="bg-white rounded-2xl border border-dashed border-black/10 p-10 text-center text-sm text-[#0F2A44]/40">
                  Nenhum saldo registrado até esta data.
                </div>
              ) : (
                <div className="space-y-4">
                  {secretariasHistorico.map((sec) => (
                    <div
                      key={sec.id}
                      {...propsCard(sec.id)}
                      className={`rounded-xl border overflow-hidden bg-white transition-shadow print:break-inside-avoid ${
                        arrastandoId === sec.id ? "opacity-50" : ""
                      } ${sobreId === sec.id ? "border-[#C9A227] shadow-md" : "border-black/5"}`}
                    >
                      <div
                        className="flex items-center justify-between px-4 py-2.5"
                        style={{ backgroundColor: `${sec.cor}14`, borderLeft: `4px solid ${sec.cor}` }}
                      >
                        <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: sec.cor }}>
                          <span
                            {...propsAlca(sec.id)}
                            className="cursor-grab active:cursor-grabbing text-[#0F2A44]/25 hover:text-[#0F2A44]/60 print:hidden"
                            title="Arraste para reordenar as secretarias"
                          >
                            <GripVertical size={15} />
                          </span>
                          {sec.nome.toUpperCase()}
                        </span>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => imprimirSecretaria(sec)}
                            className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-black/10 print:hidden"
                            style={{ color: sec.cor }}
                            title={`Imprimir apenas ${sec.nome}`}
                          >
                            <Printer size={12} /> Imprimir
                          </button>
                        </div>
                      </div>
                      <div className="overflow-x-auto print:overflow-visible">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/40">
                            <th className="px-4 py-2 font-medium whitespace-nowrap">Banco</th>
                            <th className="px-4 py-2 font-medium whitespace-nowrap">Número da Conta</th>
                            <th className="px-4 py-2 font-medium text-right whitespace-nowrap">Saldo</th>
                            <th className="px-4 py-2 font-medium whitespace-nowrap">Nome da Conta</th>
                            <th className="px-4 py-2 font-medium whitespace-nowrap">Saldo registrado em</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sec.contas.map((c) => (
                            <tr key={c.id} className="border-t border-black/5">
                              <td className={`px-4 py-2.5 whitespace-nowrap ${classeTextoLongo(c.banco)}`}>{c.banco}</td>
                              <td className="px-4 py-2.5 whitespace-nowrap text-[#0F2A44]/60">{c.numero_conta || "--"}</td>
                              <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums font-bold">{formatBRL(c.saldo)}</td>
                              <td className={`px-4 py-2.5 whitespace-nowrap ${classeTextoLongo(c.nome_conta)}`}>{c.nome_conta}</td>
                              <td className="px-4 py-2.5 text-xs whitespace-nowrap text-[#0F2A44]/50">
                                {c.dataDoSaldo === dataSelecionada
                                  ? "Neste dia"
                                  : new Date(c.dataDoSaldo + "T00:00:00").toLocaleDateString("pt-BR")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
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

      {modalConta && (
        <ModalContaBancaria
          modo={modalConta.modo}
          conta={modalConta.conta}
          secretarias={secretarias}
          bancos={bancos}
          fontes={comFonteRecurso ? fontes : null}
          onCancelar={() => setModalConta(null)}
          onSalvar={salvarConta}
        />
      )}

      {situacaoPendente && (
        <ModalSituacaoConta
          conta={situacaoPendente.conta}
          destino={situacaoPendente.destino}
          detalhes={situacaoPendente.detalhes}
          programacoes={situacaoPendente.programacoes}
          verificando={situacaoPendente.verificando}
          onCancelar={() => setSituacaoPendente(null)}
          onConfirmar={confirmarSituacao}
        />
      )}

      {limparPendente && (
        <ModalLimparCampos
          quantidade={camposPreenchidosNoLote()}
          onCancelar={() => setLimparPendente(null)}
          onConfirmar={limparCamposLote}
        />
      )}
    </Layout>
  );
}
