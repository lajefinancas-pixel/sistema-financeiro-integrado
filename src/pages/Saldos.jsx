import React from "react";
import {
  Plus, X, Pencil, Save, Trash2, Printer, FileText, FileSpreadsheet, Upload,
  ChevronLeft, ChevronRight, GripVertical,
} from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabaseClient";
import { imprimirSaldos, gerarPdfSaldos, agoraBR } from "../lib/saldosDocumento";
import { carregarSaldosDasContas } from "../lib/saldosContasDados";
import { totalizarSaldos } from "../lib/saldosContas";
import { somar } from "../lib/rateioPagamentos";
import Layout from "../components/Layout";
import CampoMoeda from "../components/CampoMoeda";
import { paraNumeroMoeda } from "../lib/moeda";
import { erroAmigavel, mensagemAmigavel } from "../lib/erros";

const CORES = ["#2563EB", "#16A34A", "#EA9A1E", "#7C3AED", "#DB2777", "#0EA5E9", "#059669", "#D97706"];
const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];
const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function formatBRL(v) {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
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
function gerarDiasDoMes(ano, mes) {
  const primeiroDia = new Date(ano, mes, 1);
  const ultimoDia = new Date(ano, mes + 1, 0);
  const diasAntes = primeiroDia.getDay();
  const dias = [];
  for (let i = 0; i < diasAntes; i++) dias.push(null);
  for (let d = 1; d <= ultimoDia.getDate(); d++) dias.push(d);
  return dias;
}

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

export default function Saldos() {
  const [modoVisualizacao, setModoVisualizacao] = React.useState("atual");

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

  const [editandoSecretariaId, setEditandoSecretariaId] = React.useState(null);
  const [saldosLote, setSaldosLote] = React.useState({});
  const [dataLote, setDataLote] = React.useState(hojeISO());

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

  const hoje = new Date();
  const [mesExibido, setMesExibido] = React.useState(hoje.getMonth());
  const [anoExibido, setAnoExibido] = React.useState(hoje.getFullYear());
  const [dataSelecionada, setDataSelecionada] = React.useState(hojeISO());
  const [datasComSaldo, setDatasComSaldo] = React.useState(new Set());
  const [contasPorSecretariaNaData, setContasPorSecretariaNaData] = React.useState([]);
  const [carregandoHistorico, setCarregandoHistorico] = React.useState(true);

  const [usuarioId, setUsuarioId] = React.useState(null);
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

      const { data: contas, error: e3 } = await supabase
        .from("contas_bancarias")
        .select("id, nome_conta, numero_conta, tipo_conta, secretaria_id, banco_id, bancos(nome)")
        .eq("ativo", true);
      if (e3) throw e3;

      // O Saldo Real de cada conta vem da fonte única (consulta paginada, um
      // registro por conta) -- a mesma usada pelo Painel Principal e por
      // Pagamentos Diários.
      const { contas: contasComSaldo } = await carregarSaldosDasContas({
        contas: (contas ?? []).map((c) => ({
          id: c.id,
          secretaria_id: c.secretaria_id,
          banco: c.bancos?.nome ?? "--",
          nome_conta: c.nome_conta,
          numero_conta: c.numero_conta,
        })),
        comReservas: false,
      });

      const agrupado = (secs ?? []).map((sec, i) => {
        const contasDaSec = contasComSaldo.filter((c) => c.secretaria_id === sec.id);
        // Cada conta entra no total UMA ÚNICA VEZ, pelo id da conta.
        const total = totalizarSaldos(contasDaSec).saldoReal;
        return { id: sec.id, nome: sec.nome, cor: CORES[i % CORES.length], contas: contasDaSec, total };
      });

      setSecretarias(secs ?? []);
      setBancos(bcs ?? []);
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

      const { data: contas, error: e2 } = await supabase
        .from("contas_bancarias")
        .select("id, nome_conta, numero_conta, secretaria_id, bancos(nome)")
        .eq("ativo", true);
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
  function iniciarEdicaoLote(sec) {
    const inicial = {};
    sec.contas.forEach((c) => {
      inicial[c.id] = c.saldo ?? 0;
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
        valor_saldo: paraNumeroMoeda(saldosLote[c.id]),
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
      setErro(mensagemAmigavel(e, "Erro ao salvar saldos em lote."));
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
      setErro(mensagemAmigavel(e, "Erro ao excluir conta."));
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
      setErro(mensagemAmigavel(e, "Erro ao excluir secretaria."));
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
        throw erroAmigavel("Preencha secretaria, banco e nome da conta.");
      }

      const { data: contaData, error: eConta } = await supabase
        .from("contas_bancarias")
        .insert({
          secretaria_id: secretariaId, banco_id: bancoId, nome_conta: form.nome_conta,
          numero_conta: form.numero_conta || null, tipo_conta: form.tipo_conta || null,
        }).select().single();
      if (eConta) throw eConta;

      const valorInicial = paraNumeroMoeda(form.saldo_inicial);
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
      setErro(mensagemAmigavel(e, "Erro ao criar conta."));
    } finally {
      setSalvando(false);
    }
  }

  async function salvarNovoSaldo(contaId) {
    setSalvando(true);
    setErro(null);
    try {
      const valor = paraNumeroMoeda(novoSaldo.valor);
      const { error } = await supabase.from("saldos_historico").upsert(
        { conta_id: contaId, valor_saldo: valor, data_saldo: novoSaldo.data },
        { onConflict: "conta_id,data_saldo" }
      );
      if (error) throw error;
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

          const valor = paraNumeroMoeda(saldoStr);
          const { error: eSaldo } = await supabase.from("saldos_historico").insert({
            conta_id: contaData.id,
            valor_saldo: valor,
            data_saldo: hojeISO(),
          });
          if (eSaldo) throw eSaldo;

          criadas++;
        } catch (e) {
          erros.push(`Linha "${linha}": ${mensagemAmigavel(e, "não foi possível importar esta linha.")}`);
        }
      }

      setResultadoImportar({ criadas, erros });
      if (criadas > 0) {
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

        {modoVisualizacao === "atual" && mostrarForm && (
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
                <CampoMoeda
                  placeholder="R$ 0,00"
                  valor={form.saldo_inicial}
                  onValorChange={(numero) => setForm({ ...form, saldo_inicial: numero })}
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
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold" style={{ color: sec.cor }}>
                          Total: {formatBRL(sec.total)}
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
                                  <CampoMoeda
                                    valor={saldosLote[c.id] ?? ""}
                                    onValorChange={(numero) =>
                                      setSaldosLote((atual) => ({ ...atual, [c.id]: numero }))
                                    }
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
                                          onClick={() => { setEditando(c.id); setNovoSaldo({ valor: c.saldo ?? 0, data: hojeISO() }); }}
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
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
        {modoVisualizacao === "historico" && (
          <div className="grid grid-cols-[280px_1fr] gap-6 print:block">
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 h-fit print:hidden">
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
                          <span className="text-sm font-semibold" style={{ color: sec.cor }}>
                            Total: {formatBRL(sec.total)}
                          </span>
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
    </Layout>
  );
}
