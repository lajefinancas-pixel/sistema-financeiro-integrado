import React from "react";
import {
  Printer, FileText, FileSpreadsheet, Landmark, Users, BarChart2, ChevronRight, ChevronDown,
  RefreshCw, Receipt, UserCog, ShieldCheck, Plus, Sparkles, BarChart3, GitCompare, Star,
  FileCheck2,
} from "lucide-react";
import Layout from "../components/Layout";
import AcessoNegado from "../components/AcessoNegado";
import ConstrutorRelatorio, { RelatoriosSalvos } from "../components/relatorios/ConstrutorRelatorio";
import ResultadoPersonalizado from "../components/relatorios/ResultadoPersonalizado";
import GraficoRelatorio from "../components/relatorios/GraficoRelatorio";
import OpcoesImpressao from "../components/relatorios/OpcoesImpressao";
import PainelComparativo from "../components/relatorios/PainelComparativo";
import PainelFiltros from "../components/comuns/PainelFiltros";
import { usePermissaoRelatorios, MODULO_EQUIVALENTE } from "../lib/permissoesRelatorios";
import {
  carregarBaseFinanceira, carregarBaseFornecedores, carregarBaseTributaria,
  carregarBaseTarefas, carregarBaseHistorico, carregarBasePagamentos, carregarBaseCertidoes,
} from "../lib/relatoriosDados";
import {
  CATEGORIAS, relatoriosDaCategoria, relatorioPorId, gerarRelatorio, valorTotal, formatarCelula,
} from "../lib/relatoriosCatalogo";
import {
  configuracaoPadrao, FONTES, gerarRelatorioPersonalizado, normalizarConfiguracao, resumoDosCriterios,
} from "../lib/relatoriosPersonalizados";
import {
  excluirRelatorioFavorito, listarRelatoriosFavoritos, salvarRelatorioFavorito,
} from "../lib/relatoriosFavoritos";
import { imprimirRelatorio, gerarPdfRelatorio, exportarExcelRelatorio } from "../lib/relatoriosDocumento";
import { MODO_IMPRESSAO_PADRAO, montarCabecalho, textoPeriodo } from "../lib/relatoriosCabecalho";
import { comparativoDoRelatorio } from "../lib/relatoriosComparativo";
import { dadosDoGrafico } from "../lib/relatoriosGrafico";
import { agoraBR } from "../lib/saldosDocumento";
import { formatBRL } from "../lib/moeda";
import { comTratamento, mensagemAmigavel } from "../lib/erros";

const ICONES_CATEGORIA = {
  financeiro: Landmark,
  fornecedores: Users,
  tributario: Receipt,
  usuarios: UserCog,
  auditoria: ShieldCheck,
  certidoes: FileCheck2,
};

/**
 * Bases das categorias Tributário, Usuários e Gestão, Auditoria e Certidões,
 * mais a de Pagamentos usada pelos relatórios personalizados. Cada uma é
 * carregada por conta própria: se uma tabela estiver indisponível (permissão do
 * usuário, banco sem o recurso), só a categoria dela fica sem registros -- as
 * categorias Financeiro e Fornecedores continuam intactas.
 */
const BASES_COMPLEMENTARES = [
  { chave: "tributaria", nome: "Tributário", carregar: carregarBaseTributaria },
  { chave: "tarefas", nome: "Usuários e Gestão", carregar: carregarBaseTarefas },
  { chave: "historico", nome: "Atividades e Auditoria", carregar: carregarBaseHistorico },
  { chave: "pagamentos", nome: "Pagamentos", carregar: carregarBasePagamentos },
  { chave: "certidoes", nome: "Certidões", carregar: carregarBaseCertidoes },
];

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}
function primeiroDiaDoAno() {
  return `${new Date().getFullYear()}-01-01`;
}
function nomeDoArquivo(relatorio) {
  return `${relatorio.id}-${hojeISO()}`;
}

/** "3 registros" / "1 registro" */
function textoRegistros(quantidade) {
  return `${quantidade} ${quantidade === 1 ? "registro" : "registros"}`;
}

function alinharCelula(coluna) {
  return coluna.tipo === "moeda" || coluna.tipo === "numero" ? "text-right" : "text-left";
}

function CartaoRelatorio({ relatorio, ativo, onSelecionar }) {
  return (
    <button
      type="button"
      onClick={() => onSelecionar(relatorio.id)}
      aria-pressed={ativo}
      className={`w-full text-left rounded-xl border px-4 py-3.5 transition-colors ${
        ativo
          ? "bg-[#0F2A44] border-[#0F2A44] text-white shadow-sm"
          : "bg-white border-black/5 hover:border-[#C9A227]/60 hover:bg-[#C9A227]/[0.04]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-sm font-medium ${ativo ? "text-white" : "text-[#0F2A44]"}`}>
            {relatorio.nome}
          </div>
          <div className={`text-xs mt-1 leading-relaxed ${ativo ? "text-white/70" : "text-[#0F2A44]/55"}`}>
            {relatorio.descricao}
          </div>
        </div>
        <ChevronRight size={16} className={ativo ? "text-[#C9A227] shrink-0" : "text-[#0F2A44]/25 shrink-0"} />
      </div>
    </button>
  );
}

/** "4 relatórios" / "1 relatório" */
function textoRelatorios(quantidade) {
  return `${quantidade} ${quantidade === 1 ? "relatório" : "relatórios"}`;
}

/**
 * Grupo da central em forma de sanfona: fechado, mostra só o ícone, o nome e a
 * descrição da categoria; aberto, lista os relatórios dela. Quem controla qual
 * grupo está aberto é a página, para que só um fique aberto por vez.
 */
function GrupoRelatorios({ categoria, Icone, relatorios, aberto, onAlternar, selecionado, onSelecionar }) {
  const idPainel = `grupo-relatorios-${categoria.id}`;
  return (
    <section
      className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-colors ${
        aberto ? "border-[#C9A227]/50" : "border-black/5"
      }`}
    >
      <button
        type="button"
        onClick={() => onAlternar(categoria.id)}
        aria-expanded={aberto}
        aria-controls={idPainel}
        className="w-full text-left flex items-start gap-3 p-5 hover:bg-[#C9A227]/[0.04]"
      >
        <div className="w-10 h-10 rounded-xl bg-[#0F2A44] flex items-center justify-center shrink-0">
          <Icone size={18} className="text-[#C9A227]" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-[#0F2A44] uppercase tracking-[0.1em]">
            {categoria.nome}
          </h2>
          <p className="text-xs text-[#0F2A44]/55 mt-0.5 leading-relaxed">{categoria.descricao}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-0.5">
          <span className="hidden sm:inline text-[11px] text-[#0F2A44]/40 whitespace-nowrap">
            {textoRelatorios(relatorios.length)}
          </span>
          <ChevronDown
            size={18}
            className={`text-[#0F2A44]/35 transition-transform ${aberto ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {aberto && (
        <div id={idPainel} className="px-5 pb-5 pt-1 space-y-2.5 border-t border-black/5">
          {relatorios.length === 0 ? (
            <p className="text-xs text-[#0F2A44]/45 pt-3">
              Nenhum relatório disponível nesta categoria.
            </p>
          ) : (
            relatorios.map((item) => (
              <CartaoRelatorio
                key={item.id}
                relatorio={item}
                ativo={item.id === selecionado}
                onSelecionar={onSelecionar}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

function Chip({ label, valor, destaque }) {
  return (
    <div
      className={`rounded-xl border px-4 py-2.5 ${
        destaque ? "bg-[#0F2A44] border-[#0F2A44] text-white" : "bg-[#F5F3EF] border-black/5 text-[#0F2A44]"
      }`}
    >
      <div className={`text-[10px] uppercase tracking-[0.16em] ${destaque ? "text-[#C9A227]" : "text-[#0F2A44]/45"}`}>
        {label}
      </div>
      <div className="text-sm font-semibold mt-0.5 tabular-nums">{valor}</div>
    </div>
  );
}

export default function Relatorios() {
  const {
    carregando: verificando,
    usuario,
    permissao,
    modulo,
    erro: erroPermissao,
  } = usePermissaoRelatorios();
  const podeVisualizar = permissao?.pode_visualizar === true;

  const [bases, setBases] = React.useState({
    financeira: null,
    fornecedores: null,
    tributaria: null,
    tarefas: null,
    historico: null,
    pagamentos: null,
    certidoes: null,
  });
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState(null);
  const [avisoReserva, setAvisoReserva] = React.useState(false);
  const [avisosBase, setAvisosBase] = React.useState([]);

  const [selecionado, setSelecionado] = React.useState(null);
  // Central recolhida: nenhum grupo aberto ao entrar e só um aberto por vez.
  const [categoriaAberta, setCategoriaAberta] = React.useState(null);
  const [geradoEm, setGeradoEm] = React.useState(null);
  const [periodo, setPeriodo] = React.useState({ inicio: primeiroDiaDoAno(), fim: hojeISO() });

  // --- Gráfico, comparativo e formato de impressão ---
  const [mostrarGrafico, setMostrarGrafico] = React.useState(false);
  const [tipoGrafico, setTipoGrafico] = React.useState("barras");
  const [mostrarComparativo, setMostrarComparativo] = React.useState(false);
  // O formato escolhido vale para todos os documentos da tela (pronto,
  // personalizado e comparativo), então quem emite escolhe uma vez.
  const [modoDeImpressao, setModoDeImpressao] = React.useState(MODO_IMPRESSAO_PADRAO);
  const [mostrarGraficoPersonalizado, setMostrarGraficoPersonalizado] = React.useState(false);
  const [tipoGraficoPersonalizado, setTipoGraficoPersonalizado] = React.useState("barras");

  // --- Relatórios personalizados ---
  const [mostrarConstrutor, setMostrarConstrutor] = React.useState(false);
  const [configuracao, setConfiguracao] = React.useState(() => configuracaoPadrao(FONTES[0].id));
  // Critérios do último "Gerar relatório": a tela só recalcula quando o usuário
  // manda gerar (ou quando os dados são atualizados), não a cada clique no
  // construtor.
  const [criteriosGerados, setCriteriosGerados] = React.useState(null);
  const [geradoEmPersonalizado, setGeradoEmPersonalizado] = React.useState(null);
  const [erroConstrutor, setErroConstrutor] = React.useState(null);
  const [favoritos, setFavoritos] = React.useState([]);
  const [carregandoFavoritos, setCarregandoFavoritos] = React.useState(true);
  const [erroFavoritos, setErroFavoritos] = React.useState(null);
  const [salvandoFavorito, setSalvandoFavorito] = React.useState(false);
  // null = ainda no automático: "Meus relatórios" fica recolhido enquanto não
  // houver nenhum relatório salvo. Clicar no cabeçalho passa a mandar no estado.
  const [meusRelatoriosAberto, setMeusRelatoriosAberto] = React.useState(null);

  function alternarCategoria(id) {
    setCategoriaAberta((atual) => (atual === id ? null : id));
  }

  /**
   * Categorias que este usuário vê. Certidões é a única com dono fora da
   * Central: ela só entra para quem tem pode_visualizar no módulo "certidoes",
   * que é o que a base confirma antes de trazer qualquer linha. Enquanto a
   * confirmação não chega (ou se a base falhar), a categoria fica de fora --
   * mostrá-la vazia daria a entender que o fornecedor não tem certidão.
   */
  const categoriasVisiveis = React.useMemo(
    () => CATEGORIAS.filter((c) => c.id !== "certidoes" || bases.certidoes?.permitido === true),
    [bases.certidoes]
  );

  const carregarBases = React.useCallback(async () => {
    setCarregando(true);
    setErro(null);
    setAvisosBase([]);
    try {
      const [financeira, fornecedores] = await Promise.all([
        carregarBaseFinanceira(),
        carregarBaseFornecedores(),
      ]);

      const resultados = await Promise.allSettled(BASES_COMPLEMENTARES.map((b) => b.carregar()));
      const complementares = {};
      const avisos = [];
      BASES_COMPLEMENTARES.forEach((base, indice) => {
        const resultado = resultados[indice];
        if (resultado.status === "fulfilled") {
          complementares[base.chave] = resultado.value;
        } else {
          complementares[base.chave] = null;
          avisos.push(
            `${base.nome}: ${mensagemAmigavel(resultado.reason, "os dados desta categoria não estão disponíveis.")}`
          );
        }
      });

      setBases({ financeira, fornecedores, ...complementares });
      setAvisoReserva(financeira.rateioIndisponivel === true);
      setAvisosBase(avisos);
    } catch (e) {
      setErro(mensagemAmigavel(e, "Não foi possível carregar os dados dos relatórios."));
    } finally {
      setCarregando(false);
    }
  }, []);

  React.useEffect(() => {
    if (podeVisualizar) carregarBases();
  }, [podeVisualizar, carregarBases]);

  const relatorio = relatorioPorId(selecionado);
  const resultado = React.useMemo(
    () => (relatorio ? gerarRelatorio(relatorio, bases, { periodo }) : null),
    [relatorio, bases, periodo]
  );
  const total = resultado ? valorTotal(resultado) : null;
  const grafico = React.useMemo(() => dadosDoGrafico(resultado), [resultado]);
  const comparativo = comparativoDoRelatorio(relatorio?.id);

  function selecionar(id) {
    setSelecionado(id);
    setGeradoEm(agoraBR());
    // Um resultado por vez na tela: escolher um relatório pronto fecha o personalizado.
    setCriteriosGerados(null);
    // Gráfico e comparativo recomeçam fechados: o relatório é outro.
    setMostrarGrafico(false);
    setMostrarComparativo(false);
    setTipoGrafico("barras");
  }

  async function atualizar() {
    await carregarBases();
    setGeradoEm(agoraBR());
    if (criteriosGerados) setGeradoEmPersonalizado(agoraBR());
  }

  /** Período do relatório em texto, quando ele tem filtro de datas. */
  const periodoDoRelatorio =
    relatorio?.temPeriodo ? textoPeriodo(periodo.inicio, periodo.fim) : "";

  /** Volta ao mesmo recorte com que a tela abre -- é o que "Ano corrente" já faz. */
  function voltarAoPeriodoPadrao() {
    setPeriodo({ inicio: primeiroDiaDoAno(), fim: hojeISO() });
  }

  const periodoEhOPadrao = periodo.inicio === primeiroDiaDoAno() && periodo.fim === hojeISO();

  /**
   * Chip do período do relatório pronto. O período sempre tem um valor, então o
   * chip é só informativo (como na tela de Pagamentos): nada é removido dele,
   * quem devolve o recorte inicial é o "Limpar filtros" da barra.
   */
  const chipsDoPeriodo = React.useMemo(
    () => [
      {
        chave: "periodo",
        rotulo: `Período: ${formatarCelula(periodo.inicio, "data")} a ${formatarCelula(periodo.fim, "data")}`,
      },
    ],
    [periodo]
  );

  /**
   * Filtros do relatório pronto em texto: são a categoria e o agrupamento que ele
   * já declara -- é o que define o recorte dos dados nesse caso.
   */
  const filtrosDoRelatorio = React.useMemo(
    () => [
      { label: "Categoria", valor: CATEGORIAS.find((c) => c.id === relatorio?.categoria)?.nome },
      { label: "Agrupado por", valor: resultado?.rotuloGrupo },
    ],
    [relatorio, resultado]
  );

  const cabecalhoDoRelatorio = React.useMemo(
    () =>
      montarCabecalho({
        relatorio: resultado?.nome,
        periodo: periodoDoRelatorio,
        filtros: filtrosDoRelatorio,
        geradoEm: geradoEm ?? agoraBR(),
        usuario,
      }),
    [resultado, periodoDoRelatorio, filtrosDoRelatorio, geradoEm, usuario]
  );

  const subtituloDocumento = React.useMemo(() => {
    const emitido = `Emitido em ${geradoEm ?? agoraBR()}`;
    const porQuem = usuario?.nome_completo ? ` por ${usuario.nome_completo}` : "";
    const trecho =
      relatorio?.temPeriodo && (periodo.inicio || periodo.fim)
        ? `Período de ${formatarCelula(periodo.inicio, "data")} a ${formatarCelula(periodo.fim, "data")} — `
        : "";
    return `${trecho}${emitido}${porQuem}`;
  }, [geradoEm, usuario, relatorio, periodo]);

  function imprimir() {
    if (!resultado || resultado.registros === 0) {
      setErro("Não há registros para imprimir neste relatório.");
      return;
    }
    imprimirRelatorio({
      titulo: resultado.nome,
      subtitulo: subtituloDocumento,
      resultado,
      cabecalho: cabecalhoDoRelatorio,
      modo: modoDeImpressao,
    });
  }

  function baixarPdf() {
    if (!resultado || resultado.registros === 0) {
      setErro("Não há registros para gerar o PDF deste relatório.");
      return;
    }
    gerarPdfRelatorio({
      titulo: resultado.nome,
      subtitulo: subtituloDocumento,
      resultado,
      cabecalho: cabecalhoDoRelatorio,
      modo: modoDeImpressao,
      arquivo: `${nomeDoArquivo(relatorio)}.pdf`,
    });
  }

  function baixarExcel() {
    if (!resultado || resultado.registros === 0) {
      setErro("Não há registros para exportar neste relatório.");
      return;
    }
    exportarExcelRelatorio({
      titulo: resultado.nome,
      resultado,
      arquivo: `${nomeDoArquivo(relatorio)}.xlsx`,
    });
  }

  /**
   * Documentos do comparativo. O cabeçalho é o mesmo padrão dos outros, com o
   * resumo da comparação entrando na linha de filtros.
   */
  function documentoComparativo(acao, resultadoComparativo, filtros) {
    if (!resultadoComparativo || resultadoComparativo.registros === 0) {
      setErro("Não há valores para gerar este comparativo.");
      return;
    }
    const cabecalho = montarCabecalho({
      relatorio: resultadoComparativo.nome,
      periodo: periodoDoRelatorio,
      filtros,
      geradoEm: agoraBR(),
      usuario,
    });
    const arquivo = `${relatorio?.id ?? "relatorio"}-comparativo-${hojeISO()}`;

    if (acao === "imprimir") {
      imprimirRelatorio({
        titulo: resultadoComparativo.nome,
        resultado: resultadoComparativo,
        cabecalho,
        modo: modoDeImpressao,
      });
      return;
    }
    if (acao === "pdf") {
      gerarPdfRelatorio({
        titulo: resultadoComparativo.nome,
        resultado: resultadoComparativo,
        cabecalho,
        modo: modoDeImpressao,
        arquivo: `${arquivo}.pdf`,
      });
      return;
    }
    exportarExcelRelatorio({
      titulo: resultadoComparativo.nome,
      resultado: resultadoComparativo,
      arquivo: `${arquivo}.xlsx`,
    });
  }

  /* --------------------------------------------------------------------
   * Relatórios personalizados
   * ----------------------------------------------------------------- */

  // Consulta isolada: se a tabela de relatórios salvos ainda não existir no
  // banco, só os atalhos ficam de fora -- o construtor continua funcionando.
  const carregarFavoritos = React.useCallback(async () => {
    setCarregandoFavoritos(true);
    const { dados, erro: falha } = await comTratamento(
      listarRelatoriosFavoritos,
      "Não foi possível carregar seus relatórios salvos. O construtor continua disponível."
    );
    setFavoritos(dados ?? []);
    setErroFavoritos(falha);
    setCarregandoFavoritos(false);
  }, []);

  React.useEffect(() => {
    if (podeVisualizar) carregarFavoritos();
  }, [podeVisualizar, carregarFavoritos]);

  const resultadoPersonalizado = React.useMemo(
    () =>
      criteriosGerados
        ? gerarRelatorioPersonalizado(criteriosGerados.configuracao, bases, {
            nome: criteriosGerados.nome,
          })
        : null,
    [criteriosGerados, bases]
  );

  // --- Rolagem automática até o resultado ---
  // Assim que os dados terminam de carregar, a tela desce sozinha até o topo do
  // bloco de resultado (pronto ou personalizado), sem precisar rolar à mão.
  const areaResultadoRef = React.useRef(null);
  // Rola uma vez por relatório escolhido: atualizar os dados do mesmo relatório
  // não puxa a tela de novo.
  const ultimoResultadoRolado = React.useRef(null);

  React.useEffect(() => {
    if (carregando) return;
    const alvo = resultadoPersonalizado
      ? criteriosGerados
      : relatorio && resultado
        ? selecionado
        : null;
    if (!alvo || ultimoResultadoRolado.current === alvo) return;
    ultimoResultadoRolado.current = alvo;
    areaResultadoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [carregando, selecionado, relatorio, resultado, criteriosGerados, resultadoPersonalizado]);

  function gerarPersonalizado(config, nome = null) {
    const pronta = normalizarConfiguracao(config ?? configuracao);
    if (pronta.colunas.length === 0) {
      setErroConstrutor("Escolha pelo menos uma coluna para o relatório.");
      return;
    }
    setErroConstrutor(null);
    setConfiguracao(pronta);
    setCriteriosGerados({ configuracao: pronta, nome });
    setGeradoEmPersonalizado(agoraBR());
    setMostrarGraficoPersonalizado(false);
    setTipoGraficoPersonalizado("barras");
    // Um resultado por vez na tela: gerar o personalizado fecha o relatório pronto.
    setSelecionado(null);
    setMostrarComparativo(false);
  }

  async function salvarFavorito(nome, aoConcluir) {
    setSalvandoFavorito(true);
    setErroFavoritos(null);
    try {
      const novo = await salvarRelatorioFavorito(nome, {
        versao: 1,
        ...normalizarConfiguracao(configuracao),
      });
      setFavoritos((atuais) => [novo, ...atuais]);
      aoConcluir?.();
    } catch (e) {
      setErroFavoritos(mensagemAmigavel(e, "Não foi possível salvar o relatório."));
    } finally {
      setSalvandoFavorito(false);
    }
  }

  /** Atalho de um relatório salvo: recarrega a configuração inteira e já gera. */
  function aplicarFavorito(favorito) {
    setMostrarConstrutor(true);
    setErroFavoritos(null);
    gerarPersonalizado(favorito?.configuracao, favorito?.nome);
  }

  async function excluirFavorito(favorito) {
    if (!confirm(`Excluir o relatório salvo "${favorito.nome}"?`)) return;
    setErroFavoritos(null);
    try {
      await excluirRelatorioFavorito(favorito.id);
      setFavoritos((atuais) => atuais.filter((f) => f.id !== favorito.id));
    } catch (e) {
      setErroFavoritos(mensagemAmigavel(e, "Não foi possível excluir o relatório salvo."));
    }
  }

  const subtituloPersonalizado = React.useMemo(() => {
    const criterios = criteriosGerados?.configuracao;
    const inicio = criterios?.periodo?.inicio;
    const fim = criterios?.periodo?.fim;
    const trecho =
      inicio || fim
        ? `Período de ${formatarCelula(inicio, "data")} a ${formatarCelula(fim, "data")} — `
        : "";
    const emitido = `Emitido em ${geradoEmPersonalizado ?? agoraBR()}`;
    const porQuem = usuario?.nome_completo ? ` por ${usuario.nome_completo}` : "";
    return `${trecho}${emitido}${porQuem}`;
  }, [criteriosGerados, geradoEmPersonalizado, usuario]);

  const graficoPersonalizado = React.useMemo(
    () => dadosDoGrafico(resultadoPersonalizado),
    [resultadoPersonalizado]
  );

  /** Cabeçalho do personalizado: os critérios escolhidos são os filtros usados. */
  const cabecalhoPersonalizado = React.useMemo(() => {
    const criterios = criteriosGerados?.configuracao;
    return montarCabecalho({
      relatorio: resultadoPersonalizado?.nome,
      periodo: textoPeriodo(criterios?.periodo?.inicio, criterios?.periodo?.fim),
      filtros: resumoDosCriterios(criterios),
      geradoEm: geradoEmPersonalizado ?? agoraBR(),
      usuario,
    });
  }, [criteriosGerados, resultadoPersonalizado, geradoEmPersonalizado, usuario]);

  function nomeArquivoPersonalizado() {
    return `relatorio-personalizado-${criteriosGerados?.configuracao?.fonte ?? "dados"}-${hojeISO()}`;
  }

  function documentoPersonalizadoIndisponivel(acao) {
    if (resultadoPersonalizado && resultadoPersonalizado.registros > 0) return false;
    setErro(`Não há registros para ${acao} neste relatório personalizado.`);
    return true;
  }

  function imprimirPersonalizado() {
    if (documentoPersonalizadoIndisponivel("imprimir")) return;
    imprimirRelatorio({
      titulo: resultadoPersonalizado.nome,
      subtitulo: subtituloPersonalizado,
      resultado: resultadoPersonalizado,
      cabecalho: cabecalhoPersonalizado,
      modo: modoDeImpressao,
    });
  }

  function baixarPdfPersonalizado() {
    if (documentoPersonalizadoIndisponivel("gerar o PDF")) return;
    gerarPdfRelatorio({
      titulo: resultadoPersonalizado.nome,
      subtitulo: subtituloPersonalizado,
      resultado: resultadoPersonalizado,
      cabecalho: cabecalhoPersonalizado,
      modo: modoDeImpressao,
      arquivo: `${nomeArquivoPersonalizado()}.pdf`,
    });
  }

  function baixarExcelPersonalizado() {
    if (documentoPersonalizadoIndisponivel("exportar")) return;
    exportarExcelRelatorio({
      titulo: resultadoPersonalizado.nome,
      resultado: resultadoPersonalizado,
      arquivo: `${nomeArquivoPersonalizado()}.xlsx`,
    });
  }

  const infoLayout = usuario ? { nome: usuario.nome_completo } : undefined;

  if (verificando) {
    return (
      <Layout usuario={infoLayout}>
        <div className="px-6 sm:px-8 py-7 text-sm text-[#0F2A44]/50">Verificando permissões...</div>
      </Layout>
    );
  }

  if (erroPermissao) {
    return (
      <Layout usuario={infoLayout}>
        <AcessoNegado
          modulo="Relatórios"
          detalhe={`Não foi possível confirmar suas permissões: ${erroPermissao}`}
        />
      </Layout>
    );
  }

  if (!podeVisualizar) {
    return (
      <Layout usuario={infoLayout}>
        <AcessoNegado modulo="Relatórios" />
      </Layout>
    );
  }

  return (
    <Layout usuario={infoLayout}>
      <div className="px-5 sm:px-8 py-6 sm:py-7">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-[#C9A227] font-medium">
              Central de Relatórios
            </div>
            <h1 className="text-2xl font-semibold text-[#0F2A44] mt-0.5">Relatórios</h1>
            <p className="text-sm text-[#0F2A44]/60 mt-0.5">
              {carregando
                ? "Carregando dados dos relatórios..."
                : "Escolha um relatório para ver os dados, imprimir ou exportar."}
            </p>
          </div>
          <button
            type="button"
            onClick={atualizar}
            disabled={carregando}
            className="self-start flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5 disabled:opacity-40"
          >
            <RefreshCw size={14} className={carregando ? "animate-spin" : undefined} />
            Atualizar dados
          </button>
        </div>

        {modulo === MODULO_EQUIVALENTE && (
          <div className="bg-[#C9A227]/10 border border-[#C9A227]/30 text-[#0F2A44] text-xs rounded-lg px-4 py-2.5 mb-5">
            O módulo "Relatórios" ainda não está configurado nos perfis de acesso: sua permissão de
            Auditoria está valendo como equivalente temporário.
          </div>
        )}

        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-5">
            {erro}
          </div>
        )}

        {avisoReserva && relatorio?.id === "consolidado-financeiro" && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-4 py-2.5 mb-5">
            O consolidado está mostrando o saldo real das contas: o valor reservado das programações
            ainda não está disponível neste ambiente.
          </div>
        )}

        {avisosBase.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-4 py-2.5 mb-5 space-y-1">
            {avisosBase.map((aviso) => (
              <div key={aviso}>{aviso}</div>
            ))}
          </div>
        )}

        {bases.historico?.truncado && relatorio?.base === "historico" && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-4 py-2.5 mb-5">
            Este relatório está mostrando os {bases.historico.limite} registros mais recentes da
            trilha de alterações.
          </div>
        )}

        {/* Central recolhida: um card fechado por grupo, aberto só ao clicar. */}
        <div className="space-y-3 mb-6">
          {categoriasVisiveis.map((categoria) => (
            <GrupoRelatorios
              key={categoria.id}
              categoria={categoria}
              Icone={ICONES_CATEGORIA[categoria.id] ?? BarChart2}
              relatorios={relatoriosDaCategoria(categoria.id)}
              aberto={categoriaAberta === categoria.id}
              onAlternar={alternarCategoria}
              selecionado={selecionado}
              onSelecionar={selecionar}
            />
          ))}
        </div>

        {/* Relatórios personalizados: construtor próprio e atalhos salvos. */}
        <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#0F2A44] flex items-center justify-center shrink-0">
                <Sparkles size={18} className="text-[#C9A227]" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-[#0F2A44] uppercase tracking-[0.1em]">
                  Relatórios personalizados
                </h2>
                <p className="text-xs text-[#0F2A44]/55 mt-0.5 leading-relaxed">
                  Monte o seu relatório escolhendo a fonte de dados, o período, os filtros, as
                  colunas, o agrupamento e a ordenação.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setMostrarConstrutor(true);
                setErroConstrutor(null);
              }}
              className="self-start flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-[#0F2A44] text-white font-medium hover:bg-[#0F2A44]/90 whitespace-nowrap"
            >
              <Plus size={15} /> Criar relatório personalizado
            </button>
          </div>

          {/* "Meus relatórios": recolhido por padrão, abre sozinho quando já há
              algum relatório salvo ou quando o usuário clica no cabeçalho. */}
          <div className="mt-4 border-t border-black/5 pt-3">
            <button
              type="button"
              onClick={() => setMeusRelatoriosAberto((atual) => !(atual ?? favoritos.length > 0))}
              aria-expanded={meusRelatoriosAberto ?? favoritos.length > 0}
              aria-controls="meus-relatorios"
              className="w-full flex items-center gap-2 text-left rounded-lg px-1 py-1.5 hover:bg-black/[0.03]"
            >
              <Star size={14} className="text-[#C9A227] shrink-0" />
              <span className="text-xs font-medium text-[#0F2A44]/75">Meus relatórios</span>
              {favoritos.length > 0 && (
                <span className="text-[10px] font-semibold text-[#0F2A44]/50 bg-[#F5F3EF] rounded-full px-2 py-0.5">
                  {favoritos.length}
                </span>
              )}
              <ChevronDown
                size={15}
                className={`ml-auto text-[#0F2A44]/35 transition-transform ${
                  (meusRelatoriosAberto ?? favoritos.length > 0) ? "rotate-180" : ""
                }`}
              />
            </button>

            {(meusRelatoriosAberto ?? favoritos.length > 0) && (
              <div id="meus-relatorios" className="mt-3">
                {!carregandoFavoritos && !erroFavoritos && favoritos.length === 0 ? (
                  <p className="text-[11px] text-[#0F2A44]/40">
                    Você ainda não tem relatórios salvos. Monte um relatório personalizado e salve
                    para vê-lo aqui.
                  </p>
                ) : (
                  <RelatoriosSalvos
                    favoritos={favoritos}
                    carregando={carregandoFavoritos}
                    erro={erroFavoritos}
                    onAplicar={aplicarFavorito}
                    onExcluir={excluirFavorito}
                  />
                )}
              </div>
            )}
          </div>

          {mostrarConstrutor && (
            <ConstrutorRelatorio
              configuracao={configuracao}
              onAlterar={setConfiguracao}
              bases={bases}
              onGerar={() => gerarPersonalizado(configuracao)}
              onSalvar={salvarFavorito}
              salvando={salvandoFavorito}
              erro={erroConstrutor}
              onFechar={() => setMostrarConstrutor(false)}
            />
          )}
        </section>

        {/* Resultado do relatório selecionado, na mesma tela. */}
        {/* Âncora da rolagem automática: topo da área de resultado. */}
        <div ref={areaResultadoRef} className="scroll-mt-4" />

        {!relatorio && !resultadoPersonalizado && (
          <div className="bg-white rounded-2xl border border-dashed border-black/10 p-10 text-center">
            <BarChart2 size={26} className="text-[#0F2A44]/20 mx-auto mb-3" />
            <p className="text-sm text-[#0F2A44]/50">
              Nenhum relatório selecionado. Escolha um dos itens acima para ver os dados aqui.
            </p>
          </div>
        )}

        {resultadoPersonalizado && (
          <ResultadoPersonalizado
            resultado={resultadoPersonalizado}
            geradoEm={geradoEmPersonalizado ?? agoraBR()}
            autor={usuario?.nome_completo}
            carregando={carregando}
            onImprimir={imprimirPersonalizado}
            onPdf={baixarPdfPersonalizado}
            onExcel={baixarExcelPersonalizado}
            grafico={graficoPersonalizado}
            mostrarGrafico={mostrarGraficoPersonalizado}
            onMostrarGrafico={() => setMostrarGraficoPersonalizado((v) => !v)}
            tipoGrafico={tipoGraficoPersonalizado}
            onTipoGrafico={setTipoGraficoPersonalizado}
            modoImpressao={modoDeImpressao}
            onModoImpressao={setModoDeImpressao}
          />
        )}

        {relatorio && resultado && (
          <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
            <header className="px-5 sm:px-6 py-5 border-b border-black/5">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#C9A227] font-medium">
                    {CATEGORIAS.find((c) => c.id === relatorio.categoria)?.nome}
                  </div>
                  <h2 className="text-lg font-semibold text-[#0F2A44] mt-0.5">{resultado.nome}</h2>
                  <p className="text-xs text-[#0F2A44]/55 mt-1">
                    Gerado em {geradoEm ?? agoraBR()}
                    {usuario?.nome_completo ? ` por ${usuario.nome_completo}` : ""}
                    {usuario?.cargo ? ` — ${usuario.cargo}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {grafico && (
                    <button
                      onClick={() => setMostrarGrafico((v) => !v)}
                      aria-pressed={mostrarGrafico}
                      className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border ${
                        mostrarGrafico
                          ? "bg-[#0F2A44] border-[#0F2A44] text-white"
                          : "border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
                      }`}
                    >
                      <BarChart3 size={14} /> {mostrarGrafico ? "Ocultar gráfico" : "Ver gráfico"}
                    </button>
                  )}
                  {comparativo && (
                    <button
                      onClick={() => setMostrarComparativo((v) => !v)}
                      aria-pressed={mostrarComparativo}
                      className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border ${
                        mostrarComparativo
                          ? "bg-[#0F2A44] border-[#0F2A44] text-white"
                          : "border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
                      }`}
                    >
                      <GitCompare size={14} />{" "}
                      {mostrarComparativo ? "Ocultar comparativo" : "Comparativo"}
                    </button>
                  )}
                  <button
                    onClick={imprimir}
                    className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
                  >
                    <Printer size={14} /> Imprimir
                  </button>
                  <button
                    onClick={baixarPdf}
                    className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
                  >
                    <FileText size={14} /> PDF
                  </button>
                  <button
                    onClick={baixarExcel}
                    className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/70 hover:bg-black/5"
                  >
                    <FileSpreadsheet size={14} /> Excel
                  </button>
                </div>
              </div>

              {/* Período do relatório: recolhido por padrão, com o recorte
                  atual à vista no chip da barra. */}
              {relatorio.temPeriodo && (
                <PainelFiltros
                  className="mt-5"
                  rotulo="Período"
                  chips={chipsDoPeriodo}
                  onLimpar={periodoEhOPadrao ? undefined : voltarAoPeriodoPadrao}
                >
                  <div className="flex flex-wrap items-end gap-3 pt-3">
                    <label className="text-xs text-[#0F2A44]/60">
                      <span className="block mb-1">Data inicial</span>
                      <input
                        type="date"
                        value={periodo.inicio}
                        onChange={(e) => setPeriodo({ ...periodo, inicio: e.target.value })}
                        className="text-sm px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44] bg-white"
                      />
                    </label>
                    <label className="text-xs text-[#0F2A44]/60">
                      <span className="block mb-1">Data final</span>
                      <input
                        type="date"
                        value={periodo.fim}
                        onChange={(e) => setPeriodo({ ...periodo, fim: e.target.value })}
                        className="text-sm px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44] bg-white"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={voltarAoPeriodoPadrao}
                      className="text-xs px-3 py-2 rounded-lg border border-black/10 text-[#0F2A44]/60 hover:bg-black/5"
                    >
                      Ano corrente
                    </button>
                  </div>
                </PainelFiltros>
              )}

              <div className="flex flex-wrap gap-3 mt-5">
                <Chip label="Registros" valor={textoRegistros(resultado.registros)} />
                {total !== null && <Chip label={resultado.rotuloTotal} valor={formatBRL(total)} destaque />}
                {resultado.resumo.map((item) => (
                  <Chip key={item.label} label={item.label} valor={item.valor} destaque={item.destaque} />
                ))}
              </div>

              <div className="mt-5 pt-4 border-t border-black/5">
                <OpcoesImpressao
                  modo={modoDeImpressao}
                  onModo={setModoDeImpressao}
                  colunas={resultado.colunas}
                />
              </div>
            </header>

            {/* O gráfico entra acima da tabela e não a substitui. */}
            {mostrarGrafico && grafico && !carregando && (
              <GraficoRelatorio dados={grafico} tipo={tipoGrafico} onTipo={setTipoGrafico} />
            )}

            {carregando && (
              <div className="px-5 sm:px-6 py-8 text-sm text-[#0F2A44]/50">Carregando dados...</div>
            )}

            {!carregando && resultado.registros === 0 && (
              <div className="px-5 sm:px-6 py-10 text-center text-sm text-[#0F2A44]/50">
                Nenhum registro encontrado para este relatório.
              </div>
            )}

            {!carregando && resultado.registros > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#F5F3EF] border-y border-black/5">
                      {resultado.colunas.map((coluna) => (
                        <th
                          key={coluna.chave}
                          className={`px-4 py-2.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-[#0F2A44]/50 whitespace-nowrap ${alinharCelula(coluna)}`}
                        >
                          {coluna.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.grupos.map((grupo) => (
                      <React.Fragment key={grupo.nome ?? "unico"}>
                        {grupo.nome && (
                          <tr className="bg-[#0F2A44]/[0.04] border-y border-black/5">
                            <th
                              colSpan={Math.max(resultado.colunas.length - 1, 1)}
                              className="px-4 py-2 text-left text-xs font-semibold text-[#0F2A44] uppercase tracking-[0.08em] border-l-2 border-[#C9A227]"
                            >
                              {resultado.rotuloGrupo ? `${resultado.rotuloGrupo}: ${grupo.nome}` : grupo.nome}
                            </th>
                            <th className="px-4 py-2 text-right text-xs font-semibold text-[#0F2A44] whitespace-nowrap">
                              {resultado.campoTotal
                                ? formatBRL(grupo.totais?.[resultado.campoTotal])
                                : textoRegistros(grupo.linhas.length)}
                            </th>
                          </tr>
                        )}

                        {grupo.linhas.map((linha, indice) => (
                          <tr
                            key={`${grupo.nome ?? "unico"}-${linha.id ?? indice}`}
                            className="border-b border-black/5 hover:bg-[#C9A227]/[0.05]"
                          >
                            {resultado.colunas.map((coluna) => (
                              <td
                                key={coluna.chave}
                                className={`px-4 py-2.5 whitespace-nowrap ${alinharCelula(coluna)} ${
                                  coluna.tipo === "moeda"
                                    ? "font-semibold tabular-nums text-[#0F2A44]"
                                    : "text-[#0F2A44]/80"
                                }`}
                              >
                                {formatarCelula(linha[coluna.chave], coluna.tipo)}
                              </td>
                            ))}
                          </tr>
                        ))}

                        {resultado.colunas.some((c) => c.somavel) && (
                          <tr className="border-b-2 border-[#0F2A44]/15 bg-white">
                            {resultado.colunas.map((coluna, indice) => (
                              <td
                                key={coluna.chave}
                                className={`px-4 py-2.5 text-xs font-semibold text-[#0F2A44] whitespace-nowrap ${alinharCelula(coluna)}`}
                              >
                                {indice === 0
                                  ? `${grupo.nome ? "Subtotal" : "Total geral"} (${textoRegistros(grupo.linhas.length)})`
                                  : coluna.somavel
                                    ? formatarCelula(grupo.totais?.[coluna.chave], coluna.tipo)
                                    : ""}
                              </td>
                            ))}
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                  {resultado.grupos.length > 1 && total !== null && (
                    <tfoot>
                      <tr className="bg-[#0F2A44] text-white">
                        <td
                          colSpan={Math.max(resultado.colunas.length - 1, 1)}
                          className="px-4 py-3 text-xs uppercase tracking-[0.12em] font-semibold"
                        >
                          Total geral — {textoRegistros(resultado.registros)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums whitespace-nowrap">
                          {formatBRL(total)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </section>
        )}

        {/* Comparativo do relatório selecionado, abaixo do resultado dele. */}
        {relatorio && comparativo && mostrarComparativo && !carregando && (
          <div className="mt-5">
            <PainelComparativo
              relatorio={relatorio}
              config={comparativo}
              bases={bases}
              modoImpressao={modoDeImpressao}
              onModoImpressao={setModoDeImpressao}
              onDocumento={documentoComparativo}
            />
          </div>
        )}
      </div>
    </Layout>
  );
}
