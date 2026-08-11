// Relatórios comparativos da Central de Relatórios.
//
// Dois recortes, os dois em cima dos dados que já existem:
//
//  1. Mês atual x mês anterior. Nos relatórios de saldo, o "mês anterior" é a
//     posição das contas no último dia do mês passado, lida de saldos_historico
//     pela mesma fonte única que as outras telas usam (nada é recalculado aqui).
//     Nos relatórios tributários, é o recorte dos lançamentos pela data da nota.
//
//  2. Secretaria x secretaria (ou banco x banco): dois valores da mesma dimensão
//     lado a lado, com o detalhamento de cada um.
//
// Nos dois casos o resultado sai no MESMO formato de `gerarRelatorio` (colunas,
// grupos com subtotal, registros e totais), então a tabela da tela, a impressão,
// o PDF e o Excel do comparativo são os mesmos dos outros relatórios.

import { somar } from "./rateioPagamentos";
import { formatarPercentual, formatBRL, paraNumeroMoeda } from "./moeda";
import { rotuloDoMes, soData } from "./relatoriosCatalogo";

/* -------------------------------------------------------------------------
 * Quais relatórios têm comparativo
 * ---------------------------------------------------------------------- */

const DIMENSAO_SECRETARIA = {
  id: "secretaria",
  label: "Secretaria",
  campo: "secretaria",
  sub: { campo: "banco", label: "Banco" },
};

const DIMENSAO_BANCO = {
  id: "banco",
  label: "Banco",
  campo: "banco",
  sub: { campo: "secretaria", label: "Secretaria" },
};

const DIMENSAO_SECRETARIA_TRIBUTARIA = {
  id: "secretaria",
  label: "Secretaria",
  campo: "secretaria",
  sub: { campo: "razao_social", label: "Fornecedor" },
};

/** Saldos: a comparação temporal precisa da posição das contas em outra data. */
function comparativoDeSaldos(campoValor, rotuloValor) {
  return {
    fonte: "financeira",
    campoValor,
    rotuloValor,
    // Saldo é posição, não movimento: o mês anterior vem de uma consulta à
    // data de fechamento, não de um filtro nas linhas que já estão na tela.
    temporal: { tipo: "posicao" },
    dimensoes: [DIMENSAO_SECRETARIA, DIMENSAO_BANCO],
  };
}

/** Tributário: a comparação temporal é o recorte dos lançamentos pela nota. */
function comparativoTributario(campoValor, rotuloValor, filtro) {
  return {
    fonte: "tributaria",
    campoValor,
    rotuloValor,
    temporal: { tipo: "data", campo: "data_nota" },
    dimensoes: [DIMENSAO_SECRETARIA_TRIBUTARIA],
    filtro,
  };
}

export const COMPARATIVOS = {
  "saldos-bancarios": comparativoDeSaldos("saldo", "Saldo"),
  "saldos-por-secretaria": comparativoDeSaldos("saldo", "Saldo"),
  "saldos-por-banco": comparativoDeSaldos("saldo", "Saldo"),
  "consolidado-financeiro": comparativoDeSaldos("saldo", "Saldo total"),
  "iss-retido": comparativoTributario("valor_iss", "ISS retido", (l) => l.valor_iss > 0),
  "irpj-retido": comparativoTributario("valor_ir", "IRPJ retido", (l) => l.valor_ir > 0),
  "retencoes-tributarias": comparativoTributario(
    "total_retido",
    "Total retido",
    (l) => l.total_retido > 0
  ),
};

export function comparativoDoRelatorio(id) {
  return COMPARATIVOS[String(id ?? "")] ?? null;
}

export const MODOS_COMPARATIVO = [
  { id: "temporal", rotulo: "Mês atual x mês anterior" },
  { id: "dimensao", rotulo: "Lado a lado" },
];

/** "Secretaria x secretaria" -- o rótulo do modo lado a lado na dimensão escolhida. */
export function rotuloModoDimensao(dimensao) {
  const nome = String(dimensao?.label ?? "").toLowerCase();
  return nome === "" ? "Lado a lado" : `${dimensao.label} x ${nome}`;
}

export function dimensaoPorId(config, id) {
  const lista = config?.dimensoes ?? [];
  return lista.find((d) => d.id === id) ?? lista[0] ?? null;
}

/* -------------------------------------------------------------------------
 * Datas: mês atual e mês anterior
 * ---------------------------------------------------------------------- */

function iso(ano, mes, dia) {
  return `${ano}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * Os dois meses da comparação temporal: o anterior completo e o atual até hoje.
 * As datas são montadas dígito a dígito, sem passar por toISOString(), que muda
 * o dia por causa do fuso.
 */
export function mesesDeComparacao(hoje = new Date()) {
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  const anoAnterior = mes === 0 ? ano - 1 : ano;
  const mesAnterior = mes === 0 ? 11 : mes - 1;
  const ultimoDiaAnterior = new Date(ano, mes, 0).getDate();

  const inicioAnterior = iso(anoAnterior, mesAnterior, 1);
  const inicioAtual = iso(ano, mes, 1);

  return {
    anterior: {
      inicio: inicioAnterior,
      fim: iso(anoAnterior, mesAnterior, ultimoDiaAnterior),
      rotulo: rotuloDoMes(inicioAnterior),
    },
    atual: {
      inicio: inicioAtual,
      fim: iso(ano, mes, hoje.getDate()),
      rotulo: rotuloDoMes(inicioAtual),
    },
  };
}

/* -------------------------------------------------------------------------
 * Linhas e totais
 * ---------------------------------------------------------------------- */

/** Linhas da base que o comparativo usa, já com o filtro próprio do relatório. */
export function linhasDoComparativo(config, bases) {
  if (!config) return [];
  const linhas =
    config.fonte === "tributaria"
      ? bases?.tributaria?.lancamentos ?? []
      : bases?.financeira?.contas ?? [];
  return config.filtro ? linhas.filter(config.filtro) : linhas;
}

/** Recorte de um mês nas fontes cujo comparativo temporal é por data. */
export function linhasDoPeriodo(config, linhas, periodo) {
  const campo = config?.temporal?.tipo === "data" ? config.temporal.campo : null;
  if (!campo) return linhas ?? [];
  const inicio = soData(periodo?.inicio);
  const fim = soData(periodo?.fim);
  return (linhas ?? []).filter((linha) => {
    const data = soData(linha?.[campo]);
    if (data === "") return false;
    if (inicio !== "" && data < inicio) return false;
    if (fim !== "" && data > fim) return false;
    return true;
  });
}

/** Valores existentes de uma dimensão, para preencher os selects do lado a lado. */
export function valoresDaDimensao(linhas, dimensao) {
  const campo = dimensao?.campo;
  if (!campo) return [];
  const valores = new Set();
  (linhas ?? []).forEach((linha) => {
    const texto = String(linha?.[campo] ?? "").trim();
    if (texto !== "") valores.add(texto);
  });
  return [...valores].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
}

function totaisPorChave(linhas, campoChave, campoValor) {
  const mapa = new Map();
  (linhas ?? []).forEach((linha) => {
    const chave = String(linha?.[campoChave] ?? "").trim() || "--";
    const anterior = mapa.get(chave) ?? { valor: 0, registros: 0 };
    mapa.set(chave, {
      valor: somar([anterior.valor, linha?.[campoValor]]),
      registros: anterior.registros + 1,
    });
  });
  return mapa;
}

/**
 * Diferença e percentual de crescimento/redução entre dois valores.
 * Sem base de comparação (lado anterior zerado) o percentual fica nulo: a tela
 * mostra "--" em vez de inventar um crescimento infinito.
 */
export function variacao(valorA, valorB) {
  const a = paraNumeroMoeda(valorA);
  const b = paraNumeroMoeda(valorB);
  const diferenca = somar([b, -a]);
  return { diferenca, percentual: a === 0 ? null : (diferenca / Math.abs(a)) * 100 };
}

const COL_DIFERENCA = { chave: "diferenca", label: "Diferença", tipo: "moeda", somavel: true, peso: 20 };
const COL_PERCENTUAL = { chave: "percentual", label: "Variação", tipo: "percentual", peso: 13 };

function montarResultado({
  id,
  nome,
  descricao,
  rotuloDimensao,
  rotuloA,
  rotuloB,
  linhas,
  rotuloValor,
  comparativo,
}) {
  const colunas = [
    { chave: "dimensao", label: rotuloDimensao, peso: 26 },
    { chave: "valorA", label: rotuloA, tipo: "moeda", somavel: true, peso: 20 },
    { chave: "valorB", label: rotuloB, tipo: "moeda", somavel: true, peso: 20 },
    COL_DIFERENCA,
    COL_PERCENTUAL,
  ];

  const totalA = somar(linhas.map((l) => l.valorA));
  const totalB = somar(linhas.map((l) => l.valorB));
  const geral = variacao(totalA, totalB);
  const totais = {
    valorA: totalA,
    valorB: totalB,
    diferenca: geral.diferenca,
    percentual: geral.percentual,
  };

  return {
    id,
    nome,
    descricao,
    colunas,
    rotuloGrupo: null,
    campoTotal: "valorB",
    rotuloTotal: `${rotuloValor} — ${rotuloB}`,
    grupos: [{ nome: null, linhas, totais }],
    registros: linhas.length,
    totais,
    resumo: [
      { label: rotuloA, valor: formatBRL(totalA) },
      { label: "Diferença", valor: formatBRL(geral.diferenca) },
      { label: "Variação", valor: formatarPercentual(geral.percentual), destaque: true },
    ],
    // Lido pelo gráfico e pelo painel: os dois lados da comparação.
    comparativo: {
      ...comparativo,
      rotuloA,
      rotuloB,
      totalA,
      totalB,
      diferenca: geral.diferenca,
      percentual: geral.percentual,
    },
  };
}

/** Da maior movimentação para a menor, considerando os dois lados. */
function porRelevancia(a, b) {
  const peso = (linha) => Math.max(Math.abs(linha.valorA), Math.abs(linha.valorB));
  return peso(b) - peso(a) || String(a.dimensao).localeCompare(String(b.dimensao), "pt-BR");
}

function unirChaves(mapaA, mapaB) {
  return [...new Set([...mapaA.keys(), ...mapaB.keys()])];
}

/* -------------------------------------------------------------------------
 * Os dois comparativos
 * ---------------------------------------------------------------------- */

/**
 * Mês atual x mês anterior, uma linha por valor da dimensão (secretaria, banco).
 * `linhasAnterior` e `linhasAtual` já vêm recortadas por quem chamou -- nas
 * fontes de posição, o lado anterior é a leitura histórica das contas.
 */
export function compararMeses({
  config,
  dimensao,
  linhasAnterior,
  linhasAtual,
  meses,
  nomeRelatorio,
}) {
  if (!config || !dimensao) return null;

  const mapaA = totaisPorChave(linhasAnterior, dimensao.campo, config.campoValor);
  const mapaB = totaisPorChave(linhasAtual, dimensao.campo, config.campoValor);

  const linhas = unirChaves(mapaA, mapaB)
    .map((chave) => {
      const valorA = mapaA.get(chave)?.valor ?? 0;
      const valorB = mapaB.get(chave)?.valor ?? 0;
      const { diferenca, percentual } = variacao(valorA, valorB);
      return { id: chave, dimensao: chave, valorA, valorB, diferenca, percentual };
    })
    .sort(porRelevancia);

  const rotuloA = meses?.anterior?.rotulo ?? "Mês anterior";
  const rotuloB = meses?.atual?.rotulo ?? "Mês atual";

  return montarResultado({
    id: "comparativo-mensal",
    nome: `${nomeRelatorio} — comparativo mensal`,
    descricao: `${config.rotuloValor} por ${dimensao.label.toLowerCase()}: ${rotuloA} x ${rotuloB}`,
    rotuloDimensao: dimensao.label,
    rotuloA,
    rotuloB,
    linhas,
    rotuloValor: config.rotuloValor,
    comparativo: {
      modo: "temporal",
      dimensao: dimensao.label,
      periodoA: meses?.anterior ?? null,
      periodoB: meses?.atual ?? null,
    },
  });
}

/**
 * Dois valores da mesma dimensão lado a lado (Saúde x Educação), detalhados pela
 * dimensão de apoio -- os bancos de cada secretaria, os fornecedores de cada
 * secretaria. As chaves são a união dos dois lados: o que existe só em um deles
 * aparece com zero do outro.
 */
export function compararLadoALado({ config, dimensao, linhas, ladoA, ladoB, nomeRelatorio }) {
  if (!config || !dimensao) return null;
  const nomeA = String(ladoA ?? "").trim();
  const nomeB = String(ladoB ?? "").trim();
  if (nomeA === "" || nomeB === "") return null;

  const doLado = (nome) => (linhas ?? []).filter((l) => String(l?.[dimensao.campo] ?? "") === nome);
  const sub = dimensao.sub ?? { campo: dimensao.campo, label: dimensao.label };

  const mapaA = totaisPorChave(doLado(nomeA), sub.campo, config.campoValor);
  const mapaB = totaisPorChave(doLado(nomeB), sub.campo, config.campoValor);

  const detalhe = unirChaves(mapaA, mapaB)
    .map((chave) => {
      const valorA = mapaA.get(chave)?.valor ?? 0;
      const valorB = mapaB.get(chave)?.valor ?? 0;
      const { diferenca, percentual } = variacao(valorA, valorB);
      return { id: chave, dimensao: chave, valorA, valorB, diferenca, percentual };
    })
    .sort(porRelevancia);

  return montarResultado({
    id: "comparativo-lado-a-lado",
    nome: `${nomeRelatorio} — ${nomeA} x ${nomeB}`,
    descricao: `${config.rotuloValor} por ${sub.label.toLowerCase()}: ${nomeA} x ${nomeB}`,
    rotuloDimensao: sub.label,
    rotuloA: nomeA,
    rotuloB: nomeB,
    linhas: detalhe,
    rotuloValor: config.rotuloValor,
    comparativo: {
      modo: "dimensao",
      dimensao: dimensao.label,
      ladoA: nomeA,
      ladoB: nomeB,
    },
  });
}

/** Resumo textual do comparativo, usado no cabeçalho dos documentos. */
export function resumoDoComparativo(resultado) {
  const comparativo = resultado?.comparativo;
  if (!comparativo) return "";
  if (comparativo.modo === "temporal") {
    return `Comparativo mensal: ${comparativo.rotuloA} x ${comparativo.rotuloB} | Dimensão: ${comparativo.dimensao}`;
  }
  return `Comparativo lado a lado: ${comparativo.ladoA} x ${comparativo.ladoB} | Dimensão: ${comparativo.dimensao}`;
}
