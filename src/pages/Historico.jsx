import React from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Printer,
  FileText,
  FileSpreadsheet,
  History,
  SearchX,
} from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabaseClient";
import Layout from "../components/Layout";
import CardsAtalhoHistorico from "../components/historico/CardsAtalhoHistorico";
import CardsHistoricoModulo from "../components/historico/CardsHistoricoModulo";
import FiltrosHistorico from "../components/historico/FiltrosHistorico";
import LinhaDoTempoHistorico from "../components/historico/LinhaDoTempoHistorico";
import { mensagemAmigavel } from "../lib/erros";
import { agoraBR } from "../lib/saldosDocumento";
import {
  ATALHOS,
  FILTROS_VAZIOS,
  LIMITE_EXPORTACAO,
  POR_PAGINA,
  carregarUsuarioAtual,
  contarMovimentacoes,
  filtroPreenchido,
  listarMovimentacoes,
  listarMovimentacoesParaExportacao,
  listarSecretariasParaFiltro,
  listarUsuariosParaFiltro,
  quantidadeDeFiltros,
} from "../lib/historicoMovimentacoes";
import {
  exportarExcelHistorico,
  gerarPdfHistorico,
  imprimirHistorico,
} from "../lib/historicoDocumento";

const CORES = ["#2563EB", "#16A34A", "#EA9A1E", "#7C3AED", "#DB2777", "#0EA5E9", "#059669", "#D97706"];
const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];
const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// Mensagens de tela: nenhuma falha chega ao usuário com termo técnico, e "sem
// registro" nunca é apresentado como erro.
const FALHA_AO_CARREGAR = "Não foi possível carregar as movimentações no momento.";
const SEM_REGISTROS = "Nenhum registro disponível ainda.";

function formatBRL(v) {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function toISO(d) {
  return d.toISOString().slice(0, 10);
}
function hojeISO() {
  return toISO(new Date());
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

export default function Historico() {
  // A página abre recolhida: nada de saldos é consultado antes de alguém abrir
  // uma data, e nada de linha do tempo antes de um filtro ou do botão.
  const [carregando, setCarregando] = React.useState(false);
  const [erro, setErro] = React.useState(null);

  const hoje = new Date();
  const [mesExibido, setMesExibido] = React.useState(hoje.getMonth());
  const [anoExibido, setAnoExibido] = React.useState(hoje.getFullYear());
  const [dataExpandida, setDataExpandida] = React.useState(null);

  const [datasComSaldo, setDatasComSaldo] = React.useState(new Set());
  const [registrosNoMes, setRegistrosNoMes] = React.useState(0);
  const [contasPorSecretaria, setContasPorSecretaria] = React.useState([]);

  // Linha do tempo de movimentações: `filtros` é o formulário, `aplicados` é o
  // recorte que está valendo na consulta (só muda em "Aplicar Filtros", em
  // "Limpar Filtros" ou ao clicar num card de acesso rápido).
  const [filtros, setFiltros] = React.useState(FILTROS_VAZIOS);
  const [aplicados, setAplicados] = React.useState(FILTROS_VAZIOS);
  const [mostrarMovimentacoes, setMostrarMovimentacoes] = React.useState(false);
  const [movimentacoes, setMovimentacoes] = React.useState([]);
  const [paginaMovimentacoes, setPaginaMovimentacoes] = React.useState(0);
  const [temMais, setTemMais] = React.useState(false);
  const [carregandoMovimentacoes, setCarregandoMovimentacoes] = React.useState(false);
  const [carregandoMais, setCarregandoMais] = React.useState(false);
  const [erroMovimentacoes, setErroMovimentacoes] = React.useState(null);
  const [avisosMovimentacoes, setAvisosMovimentacoes] = React.useState([]);
  const [usuariosFiltro, setUsuariosFiltro] = React.useState([]);
  const [erroUsuariosFiltro, setErroUsuariosFiltro] = React.useState(null);
  const [secretariasFiltro, setSecretariasFiltro] = React.useState([]);
  const [erroSecretariasFiltro, setErroSecretariasFiltro] = React.useState(null);
  const [contagensAtalhos, setContagensAtalhos] = React.useState({});

  // Documentos da linha do tempo (impressão, PDF e planilha).
  const [exportando, setExportando] = React.useState(null);
  const [avisoExportacao, setAvisoExportacao] = React.useState(null);
  const [usuarioAtual, setUsuarioAtual] = React.useState(null);

  // Cada abertura de data tem um número: a resposta de uma data trocada no meio
  // do caminho é descartada em vez de sobrescrever a data que está na tela.
  const consultaDeSaldos = React.useRef(0);

  const chaveAplicados = JSON.stringify(aplicados);
  const comFiltro = filtroPreenchido(aplicados);
  const filtrosEmUso = quantidadeDeFiltros(aplicados);
  // A listagem detalhada só existe com filtro aplicado ou a pedido do usuário.
  const listarMovimentacoesNaTela = comFiltro || mostrarMovimentacoes;

  React.useEffect(() => {
    carregarDatasComSaldo();
  }, [mesExibido, anoExibido]);

  React.useEffect(() => {
    if (!dataExpandida) {
      // Data recolhida: a tela volta ao resumo e nada fica consultando.
      consultaDeSaldos.current += 1;
      setContasPorSecretaria([]);
      setCarregando(false);
      return;
    }
    carregarSaldosNaData(dataExpandida);
  }, [dataExpandida]);

  React.useEffect(() => {
    carregarListasDosFiltros();
    carregarContagensDosAtalhos();
    // Só assina o topo dos documentos: não muda nada de acesso na tela.
    carregarUsuarioAtual().then(setUsuarioAtual);
  }, []);

  React.useEffect(() => {
    let ativo = true;

    if (!listarMovimentacoesNaTela) {
      // Sem filtro e sem pedido: a lista longa nem chega a ser consultada.
      setMovimentacoes([]);
      setTemMais(false);
      setAvisosMovimentacoes([]);
      setErroMovimentacoes(null);
      setCarregandoMovimentacoes(false);
      setCarregandoMais(false);
      return undefined;
    }

    async function carregar() {
      // "Carregar mais" mantém a linha do tempo na tela: só a primeira página
      // troca a lista pelo aviso de carregamento.
      const primeiraPagina = paginaMovimentacoes === 0;
      if (primeiraPagina) setCarregandoMovimentacoes(true);
      else setCarregandoMais(true);
      setErroMovimentacoes(null);
      try {
        const resultado = await listarMovimentacoes({
          pagina: paginaMovimentacoes,
          porPagina: POR_PAGINA,
          filtros: aplicados,
        });
        if (!ativo) return;
        setMovimentacoes(resultado.movimentacoes);
        setTemMais(resultado.temMais);
        setAvisosMovimentacoes(resultado.avisos);
      } catch (e) {
        if (!ativo) return;
        setMovimentacoes([]);
        setTemMais(false);
        setAvisosMovimentacoes([]);
        setErroMovimentacoes(mensagemAmigavel(e, FALHA_AO_CARREGAR));
      } finally {
        if (ativo) {
          setCarregandoMovimentacoes(false);
          setCarregandoMais(false);
        }
      }
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [chaveAplicados, paginaMovimentacoes, listarMovimentacoesNaTela]);

  async function carregarListasDosFiltros() {
    // As duas listas são independentes: a falha de uma não tira a outra do ar.
    try {
      setUsuariosFiltro(await listarUsuariosParaFiltro());
      setErroUsuariosFiltro(null);
    } catch (e) {
      setUsuariosFiltro([]);
      setErroUsuariosFiltro(mensagemAmigavel(e, "Erro ao carregar a lista de usuários."));
    }
    try {
      setSecretariasFiltro(await listarSecretariasParaFiltro());
      setErroSecretariasFiltro(null);
    } catch (e) {
      setSecretariasFiltro([]);
      setErroSecretariasFiltro(mensagemAmigavel(e, "Erro ao carregar a lista de secretarias."));
    }
  }

  /** Número de cada card de acesso rápido (null quando a leitura não está liberada). */
  async function carregarContagensDosAtalhos() {
    try {
      const totais = await Promise.all(ATALHOS.map((atalho) => contarMovimentacoes(atalho.filtros())));
      setContagensAtalhos(Object.fromEntries(ATALHOS.map((atalho, i) => [atalho.chave, totais[i]])));
    } catch {
      // O número é um detalhe do card: sem ele o atalho continua funcionando.
      setContagensAtalhos(Object.fromEntries(ATALHOS.map((atalho) => [atalho.chave, null])));
    }
  }

  function aplicarFiltros() {
    setAplicados(filtros);
    setPaginaMovimentacoes(0);
  }

  function limparFiltros() {
    setFiltros(FILTROS_VAZIOS);
    setAplicados(FILTROS_VAZIOS);
    setPaginaMovimentacoes(0);
    // Sem filtro, a área volta ao estado recolhido com que a página abre.
    setMostrarMovimentacoes(false);
  }

  /**
   * Remoção de um filtro pelo chip, com o painel fechado. Mexe no formulário e
   * no que está aplicado ao mesmo tempo, como "Aplicar Filtros" já fazia --
   * nenhum critério novo entra aqui.
   */
  function removerFiltro(alteracao) {
    setFiltros((atuais) => ({ ...atuais, ...alteracao }));
    setAplicados((atuais) => ({ ...atuais, ...alteracao }));
    setPaginaMovimentacoes(0);
  }

  /** Abre a listagem detalhada sem nenhum filtro, a pedido do usuário. */
  function verUltimasMovimentacoes() {
    setPaginaMovimentacoes(0);
    setMostrarMovimentacoes(true);
  }

  /** O card preenche a área de filtros e já consulta com esse recorte. */
  function selecionarAtalho(atalho) {
    const recorte = atalho.filtros();
    setFiltros(recorte);
    setAplicados(recorte);
    setPaginaMovimentacoes(0);
  }

  /**
   * Documento da linha do tempo no formato pedido, sempre com o recorte que está
   * valendo na tela: os filtros aplicados vão para a consulta da exportação e
   * para o cabeçalho do documento (período, filtros, data/hora e quem emitiu).
   *
   * A consulta é a mesma da linha do tempo, então o documento sai com tudo o que
   * o recorte tem — e não apenas com as páginas já abertas na tela.
   */
  async function exportarMovimentacoes(formato) {
    if (exportando) return;
    setExportando(formato);
    setAvisoExportacao(null);
    setErroMovimentacoes(null);

    try {
      const { movimentacoes: paraDocumento, avisos, limitado } =
        await listarMovimentacoesParaExportacao({ filtros: aplicados });

      if (paraDocumento.length === 0) {
        setAvisoExportacao("Não há movimentações para exportar com os filtros atuais.");
        return;
      }

      const documento = {
        movimentacoes: paraDocumento,
        filtros: aplicados,
        usuarios: usuariosFiltro,
        usuario: usuarioAtual,
        geradoEm: agoraBR(),
      };

      if (formato === "impressao") imprimirHistorico(documento);
      else if (formato === "pdf") gerarPdfHistorico(documento);
      else exportarExcelHistorico(documento);

      const recados = [...avisos];
      if (limitado) {
        recados.push(
          `O documento saiu com as ${LIMITE_EXPORTACAO} movimentações mais recentes deste recorte. Estreite o período para exportar o restante.`,
        );
      }
      setAvisoExportacao(recados.length > 0 ? recados.join(" ") : null);
    } catch (e) {
      setErroMovimentacoes(mensagemAmigavel(e, "Não foi possível exportar as movimentações."));
    } finally {
      setExportando(null);
    }
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
      // Quantos lançamentos o mês tem — é o resumo do bloco recolhido.
      setRegistrosNoMes((data ?? []).length);
      setErro(null);
    } catch (e) {
      setRegistrosNoMes(0);
      setErro(mensagemAmigavel(e, "Não foi possível carregar o calendário de saldos no momento."));
    }
  }

  /** Contas da data aberta. Só roda quando alguém abre uma data no calendário. */
  async function carregarSaldosNaData(data) {
    const consulta = ++consultaDeSaldos.current;
    setCarregando(true);
    setErro(null);
    try {
      const { data: secs, error: e1 } = await supabase
        .from("secretarias").select("id, nome").eq("ativo", true).order("nome");
      if (e1) throw e1;

      // Sem filtro de ativo: aqui se consulta o passado, e conta desativada
      // continua tendo histórico. Só entra na tela a conta que realmente tinha
      // saldo lançado na data (o filtro por saldo !== null, mais abaixo), então
      // a conta desativada não polui datas em que ela não existia.
      const { data: contas, error: e2 } = await supabase
        .from("contas_bancarias")
        .select("id, nome_conta, numero_conta, secretaria_id, bancos(nome)");
      if (e2) throw e2;

      const { data: saldos, error: e3 } = await supabase
        .from("saldos_historico")
        .select("conta_id, valor_saldo, data_saldo")
        .lte("data_saldo", data)
        .order("data_saldo", { ascending: false });
      if (e3) throw e3;

      const saldoNaDataOuAnterior = {};
      for (const s of saldos ?? []) {
        if (!(s.conta_id in saldoNaDataOuAnterior)) {
          saldoNaDataOuAnterior[s.conta_id] = s;
        }
      }

      const agrupado = (secs ?? []).map((sec, i) => {
        const contasDaSec = (contas ?? [])
          .filter((c) => c.secretaria_id === sec.id)
          .map((c) => ({
            id: c.id,
            banco: c.bancos?.nome ?? "--",
            nome_conta: c.nome_conta,
            numero_conta: c.numero_conta,
            saldo: saldoNaDataOuAnterior[c.id]?.valor_saldo ?? null,
            dataDoSaldo: saldoNaDataOuAnterior[c.id]?.data_saldo ?? null,
          }))
          .filter((c) => c.saldo !== null);
        const total = contasDaSec.reduce((acc, c) => acc + c.saldo, 0);
        return { id: sec.id, nome: sec.nome, cor: CORES[i % CORES.length], contas: contasDaSec, total };
      }).filter((sec) => sec.contas.length > 0);

      if (consulta !== consultaDeSaldos.current) return;
      setContasPorSecretaria(agrupado);
    } catch (e) {
      if (consulta !== consultaDeSaldos.current) return;
      setContasPorSecretaria([]);
      setErro(mensagemAmigavel(e, "Não foi possível carregar os saldos desta data no momento."));
    } finally {
      if (consulta === consultaDeSaldos.current) setCarregando(false);
    }
  }

  /** Abrir uma data recolhe a anterior; clicar de novo na mesma recolhe tudo. */
  function selecionarData(iso) {
    setDataExpandida((atual) => (atual === iso ? null : iso));
  }

  /** "Ver detalhes" abre o dia de hoje; com uma data aberta, recolhe. */
  function alternarDetalhes() {
    setDataExpandida((atual) => (atual ? null : hojeISO()));
  }

  function irParaHoje() {
    const agora = new Date();
    setMesExibido(agora.getMonth());
    setAnoExibido(agora.getFullYear());
    setDataExpandida(hojeISO());
  }

  function mudarMes(delta) {
    let novoMes = mesExibido + delta;
    let novoAno = anoExibido;
    if (novoMes < 0) { novoMes = 11; novoAno--; }
    if (novoMes > 11) { novoMes = 0; novoAno++; }
    setMesExibido(novoMes);
    setAnoExibido(novoAno);
  }

  function exportarExcel() {
    const linhas = [];
    contasPorSecretaria.forEach((sec) => {
      sec.contas.forEach((c) => {
        linhas.push({ Secretaria: sec.nome, Banco: c.banco, Conta: c.nome_conta, Saldo: c.saldo, DataDoSaldo: c.dataDoSaldo });
      });
    });
    const ws = XLSX.utils.json_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Historico");
    XLSX.writeFile(wb, `historico-${dataExpandida}.xlsx`);
  }

  const dias = gerarDiasDoMes(anoExibido, mesExibido);
  const totalGeral = contasPorSecretaria.reduce((acc, s) => acc + s.total, 0);
  const dataExpandidaBR = dataExpandida
    ? new Date(dataExpandida + "T00:00:00").toLocaleDateString("pt-BR", {
        day: "2-digit", month: "long", year: "numeric",
      })
    : "";
  const totalDeDatas = datasComSaldo.size;
  return (
    <Layout>
      <div className="px-8 py-7 print:px-0 print:py-0">
        <div className="mb-6 print:hidden">
          <h1 className="text-2xl font-semibold text-[#0F2A44]">Histórico</h1>
          <p className="text-sm text-[#0F2A44]/60 mt-0.5">
            Cada histórico abre recolhido: escolha o bloco que quiser consultar.
          </p>
        </div>

        {/* Histórico de Saldos: bloco compacto com o calendário, o resumo do mês
            e o botão de abrir. As contas de uma data só são consultadas quando
            alguém abre aquela data. */}
        <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-6 print:border-0 print:shadow-none print:rounded-none print:p-0 print:mb-0">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4 print:mb-3">
            <div>
              <h2 className="text-lg font-semibold text-[#0F2A44] flex items-center gap-2">
                <CalendarDays size={18} className="text-[#0F2A44]/40 print:hidden" />
                Histórico de Saldos
              </h2>
              <p className="text-sm text-[#0F2A44]/60 print:hidden">
                {MESES[mesExibido]} {anoExibido} — {totalDeDatas}{" "}
                {totalDeDatas === 1 ? "data com movimentação" : "datas com movimentação"} ·{" "}
                {registrosNoMes} {registrosNoMes === 1 ? "registro" : "registros"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              {/* Os documentos saem da data aberta: sem data aberta não há o que
                  imprimir, então os botões só aparecem com os detalhes na tela. */}
              {dataExpandida && (
                <>
                  <button onClick={() => window.print()} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5">
                    <Printer size={14} /> Imprimir
                  </button>
                  <button onClick={() => window.print()} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5">
                    <FileText size={14} /> PDF
                  </button>
                  <button onClick={exportarExcel} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5">
                    <FileSpreadsheet size={14} /> Excel
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={alternarDetalhes}
                aria-expanded={Boolean(dataExpandida)}
                className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
              >
                {dataExpandida ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {dataExpandida ? "Ocultar detalhes" : "Ver detalhes"}
              </button>
            </div>
          </div>

          {erro && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-5 print:hidden">
              {erro}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 print:block">
            <div className="rounded-xl border border-black/5 p-4 h-fit print:hidden">
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
                  const selecionado = iso === dataExpandida;
                  return (
                    <button
                      key={i}
                      onClick={() => selecionarData(iso)}
                      aria-expanded={selecionado}
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
                onClick={irParaHoje}
                className="w-full mt-3 text-xs text-center py-2 rounded-lg border border-black/10 text-[#0F2A44]/60 hover:bg-black/5"
              >
                Ir para hoje
              </button>

              <p className="text-[10px] text-[#0F2A44]/40 mt-3">
                Os dias marcados têm movimentação de saldo. Clique em um deles para abrir só aquela data.
              </p>
            </div>
            <div>
              {!dataExpandida ? (
                /* Estado recolhido: só o resumo do mês, nenhuma conta consultada. */
                <div className="rounded-xl border border-dashed border-black/10 p-6 print:hidden">
                  <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                    <div>
                      <div className="text-2xl font-semibold text-[#0F2A44] tabular-nums">{registrosNoMes}</div>
                      <div className="text-xs text-[#0F2A44]/50">
                        {registrosNoMes === 1 ? "registro de saldo" : "registros de saldo"} em{" "}
                        {MESES[mesExibido]} {anoExibido}
                      </div>
                    </div>
                    <div>
                      <div className="text-2xl font-semibold text-[#0F2A44] tabular-nums">{totalDeDatas}</div>
                      <div className="text-xs text-[#0F2A44]/50">
                        {totalDeDatas === 1 ? "data com movimentação" : "datas com movimentação"}
                      </div>
                    </div>
                  </div>

                  <p className="text-sm text-[#0F2A44]/55 mt-4">
                    Escolha uma data no calendário para ver as contas alteradas naquele dia — secretaria,
                    banco, conta, saldo, usuário e hora. Ou use "Ver detalhes" para abrir o dia de hoje.
                  </p>

                  <button
                    type="button"
                    onClick={alternarDetalhes}
                    className="mt-4 flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90"
                  >
                    <ChevronDown size={15} /> Ver detalhes
                  </button>
                </div>
              ) : (
                <>
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-[#0F2A44] capitalize">{dataExpandidaBR}</h3>
                    <p className="text-sm text-[#0F2A44]/60">
                      Total geral: <span className="font-semibold">{formatBRL(totalGeral)}</span>
                    </p>
                  </div>

                  {carregando ? (
                    <div className="text-sm text-[#0F2A44]/50">Carregando...</div>
                  ) : contasPorSecretaria.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-black/10 p-10 text-center text-sm text-[#0F2A44]/40">
                      Nenhum saldo registrado até esta data.
                    </div>
                  ) : (
                    <div className="space-y-4 print:space-y-2">
                      {contasPorSecretaria.map((sec) => (
                        <div key={sec.id} className="rounded-xl border border-black/5 overflow-hidden bg-white print:break-inside-avoid">
                          <div
                            className="flex items-center justify-between px-4 py-2.5"
                            style={{ backgroundColor: `${sec.cor}14`, borderLeft: `4px solid ${sec.cor}` }}
                          >
                            <span className="text-sm font-semibold" style={{ color: sec.cor }}>
                              {sec.nome.toUpperCase()}
                            </span>
                            <span className="text-sm font-semibold" style={{ color: sec.cor }}>
                              Total: {formatBRL(sec.total)}
                            </span>
                          </div>
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-[11px] uppercase tracking-wide text-[#0F2A44]/40">
                                <th className="px-4 py-2 font-medium">Banco</th>
                                <th className="px-4 py-2 font-medium">Conta</th>
                                <th className="px-4 py-2 font-medium">Saldo registrado em</th>
                                <th className="px-4 py-2 font-medium text-right">Saldo</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sec.contas.map((c) => (
                                <tr key={c.id} className="border-t border-black/5">
                                  <td className="px-4 py-2.5">{c.banco}</td>
                                  <td className="px-4 py-2.5">{c.nome_conta}</td>
                                  <td className="px-4 py-2.5 text-xs text-[#0F2A44]/50">
                                    {c.dataDoSaldo === dataExpandida
                                      ? "Neste dia"
                                      : new Date(c.dataDoSaldo + "T00:00:00").toLocaleDateString("pt-BR")}
                                  </td>
                                  <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(c.saldo)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </section>

        {/* Os demais históricos, em cards compactos: cada um mostra o resumo do
            módulo e abre a lista só quando alguém clica. */}
        <CardsHistoricoModulo />

        {/* Movimentações do sistema: cards de acesso rápido, área de filtros e
            linha do tempo. Fica fora da impressão para os documentos de saldos
            continuarem saindo exatamente como antes. */}
        <div className="mt-10 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-[#0F2A44] flex items-center gap-2">
                <History size={18} className="text-[#0F2A44]/40" />
                Movimentações do sistema
              </h2>
              <p className="text-sm text-[#0F2A44]/60">
                {!listarMovimentacoesNaTela
                  ? "A lista detalhada aparece ao aplicar um filtro ou ao abrir as últimas movimentações."
                  : carregandoMovimentacoes
                    ? "Consultando movimentações..."
                    : movimentacoes.length === 0
                      ? comFiltro
                        ? "Nenhuma movimentação atende aos filtros escolhidos."
                        : SEM_REGISTROS
                      : `${movimentacoes.length}${temMais ? "+" : ""} ${
                          movimentacoes.length === 1 ? "movimentação" : "movimentações"
                        }, da mais recente para a mais antiga`}
              </p>
            </div>
            {/* Documentos da linha do tempo: os três saem com os filtros que estão
                valendo na consulta, no mesmo padrão de Saldos, Relatórios e Auditoria. */}
            <div className="flex flex-wrap items-center gap-2">
              {filtrosEmUso > 0 && (
                <span className="text-xs px-3 py-1.5 rounded-full bg-[#E7EDF5] text-[#0F2A44]">
                  {filtrosEmUso} {filtrosEmUso === 1 ? "filtro aplicado" : "filtros aplicados"}
                </span>
              )}
              {/* Sem filtro, a lista aberta a pedido do usuário pode ser recolhida de novo. */}
              {listarMovimentacoesNaTela && !comFiltro && (
                <button
                  type="button"
                  onClick={() => setMostrarMovimentacoes(false)}
                  className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border border-black/10 bg-white text-[#0F2A44]/70 hover:bg-black/5"
                >
                  <ChevronUp size={15} /> Recolher lista
                </button>
              )}
              <button
                type="button"
                onClick={() => exportarMovimentacoes("impressao")}
                disabled={carregandoMovimentacoes || exportando !== null}
                className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border border-black/10 bg-white text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
              >
                <Printer size={15} />
                {exportando === "impressao" ? "Preparando..." : "🖨 Imprimir"}
              </button>
              <button
                type="button"
                onClick={() => exportarMovimentacoes("pdf")}
                disabled={carregandoMovimentacoes || exportando !== null}
                className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border border-black/10 bg-white text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
              >
                <FileText size={15} />
                {exportando === "pdf" ? "Gerando..." : "PDF"}
              </button>
              <button
                type="button"
                onClick={() => exportarMovimentacoes("excel")}
                disabled={carregandoMovimentacoes || exportando !== null}
                className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border border-black/10 bg-white text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
              >
                <FileSpreadsheet size={15} />
                {exportando === "excel" ? "Exportando..." : "Excel"}
              </button>
            </div>
          </div>

          {avisoExportacao && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mb-4">
              {avisoExportacao}
            </div>
          )}

          <CardsAtalhoHistorico
            aplicados={aplicados}
            contagens={contagensAtalhos}
            onSelecionar={selecionarAtalho}
          />

          <FiltrosHistorico
            filtros={filtros}
            aplicados={aplicados}
            onAlterar={setFiltros}
            onAplicar={aplicarFiltros}
            onLimpar={limparFiltros}
            onRemover={removerFiltro}
            usuarios={usuariosFiltro}
            secretarias={secretariasFiltro}
            erroUsuarios={erroUsuariosFiltro}
            erroSecretarias={erroSecretariasFiltro}
            resumo={
              !listarMovimentacoesNaTela
                ? null
                : carregandoMovimentacoes
                  ? "Consultando..."
                  : `${movimentacoes.length}${temMais ? "+" : ""} ${
                      movimentacoes.length === 1 ? "movimentação" : "movimentações"
                    }`
            }
          />

          {avisosMovimentacoes.map((aviso) => (
            <div
              key={aviso}
              className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mb-4"
            >
              {aviso}
            </div>
          ))}

          {erroMovimentacoes && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
              {erroMovimentacoes}
            </div>
          )}

          {!listarMovimentacoesNaTela ? (
            /* Estado recolhido: nada de lista longa até alguém pedir. */
            <div className="bg-white rounded-2xl border border-dashed border-black/10 p-10 text-center">
              <History size={26} className="text-[#0F2A44]/20 mx-auto mb-3" />
              <div className="text-sm text-[#0F2A44]/50">
                Use os filtros acima para procurar uma movimentação específica, ou abra as últimas
                movimentações registradas pela equipe.
              </div>
              <button
                type="button"
                onClick={verUltimasMovimentacoes}
                className="mt-4 inline-flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white hover:bg-[#0F2A44]/90"
              >
                <ChevronDown size={15} /> Ver últimas movimentações
              </button>
            </div>
          ) : carregandoMovimentacoes ? (
            <div className="text-sm text-[#0F2A44]/50">Carregando...</div>
          ) : movimentacoes.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-black/10 p-10 text-center">
              <SearchX size={26} className="text-[#0F2A44]/20 mx-auto mb-3" />
              <div className="text-sm text-[#0F2A44]/40">
                {comFiltro
                  ? "Nenhuma movimentação encontrada com esses filtros. Tente ampliar o período ou limpar os filtros."
                  : SEM_REGISTROS}
              </div>
              {comFiltro && (
                <button
                  type="button"
                  onClick={limparFiltros}
                  className="mt-4 text-sm px-4 py-2.5 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
                >
                  Limpar Filtros
                </button>
              )}
            </div>
          ) : (
            <>
              <LinhaDoTempoHistorico movimentacoes={movimentacoes} />
              {temMais && (
                <div className="mt-4 text-center">
                  <button
                    type="button"
                    onClick={() => setPaginaMovimentacoes((p) => p + 1)}
                    disabled={carregandoMais}
                    className="text-sm px-4 py-2.5 rounded-lg border border-black/10 bg-white text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
                  >
                    {carregandoMais ? "Carregando..." : "Carregar mais"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
