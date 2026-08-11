// Dados dos gráficos gerenciais a partir de um resultado de relatório.
//
// Nada aqui conhece relatório por nome: a série é derivada do próprio resultado
// (colunas, grupos e campo de total), então os gráficos servem igualmente aos
// relatórios prontos, aos comparativos e aos personalizados.
//
// Três leituras saem do mesmo resultado:
//
//   categorias -- comparação entre grupos/categorias (barras e rosca);
//   evolucao   -- série no tempo, agregada por mês (linhas);
//   series     -- uma série normalmente, duas quando o resultado é comparativo.
//
// O gráfico é sempre um resumo: o valor exato de cada linha continua na tabela
// detalhada, que fica visível junto com ele.

import { somar } from "./rateioPagamentos";
import { formatBRL } from "./moeda";
import { rotuloDoMes, soData } from "./relatoriosCatalogo";
import { MAX_CATEGORIAS_ROSCA } from "./paletaGraficos";

export const TIPOS_GRAFICO = [
  { id: "barras", rotulo: "Barras", descricao: "Comparação entre categorias" },
  { id: "linhas", rotulo: "Linhas", descricao: "Evolução ao longo do tempo" },
  { id: "rosca", rotulo: "Rosca", descricao: "Proporção do total" },
];

const MAX_CATEGORIAS_BARRAS = 12;
const ROTULO_OUTROS = "Outros";

/* -------------------------------------------------------------------------
 * De onde sai o valor
 * ---------------------------------------------------------------------- */

function colunaDeValor(resultado) {
  const colunas = resultado?.colunas ?? [];
  if (resultado?.campoTotal) {
    const declarada = colunas.find((c) => c.chave === resultado.campoTotal);
    if (declarada) return declarada;
  }
  return (
    colunas.find((c) => c.somavel && (c.tipo === "moeda" || c.tipo === "numero")) ??
    colunas.find((c) => c.tipo === "moeda") ??
    null
  );
}

function colunaDeTexto(resultado) {
  return (resultado?.colunas ?? []).find((c) => !c.tipo || c.tipo === "texto") ?? null;
}

function colunaDeData(resultado) {
  return (resultado?.colunas ?? []).find((c) => c.tipo === "data") ?? null;
}

function todasAsLinhas(resultado) {
  return (resultado?.grupos ?? []).flatMap((g) => g.linhas ?? []);
}

function gruposComNome(resultado) {
  return (resultado?.grupos ?? []).filter((g) => String(g?.nome ?? "").trim() !== "");
}

/* -------------------------------------------------------------------------
 * Categorias
 * ---------------------------------------------------------------------- */

/**
 * Séries do gráfico. Comparativos têm dois lados (mês anterior x atual,
 * secretaria x secretaria); todo o resto tem uma série só.
 */
function seriesDoResultado(resultado, coluna) {
  const comparativo = resultado?.comparativo;
  if (comparativo) {
    return [
      { chave: "valorA", rotulo: comparativo.rotuloA ?? "Lado A" },
      { chave: "valorB", rotulo: comparativo.rotuloB ?? "Lado B" },
    ];
  }
  return [{ chave: "valor", rotulo: coluna?.label ?? "Valor" }];
}

function somarSeries(linhas, series, coluna) {
  const soma = {};
  series.forEach((serie) => {
    const campo = serie.chave === "valor" ? coluna?.chave : serie.chave;
    soma[serie.chave] = somar((linhas ?? []).map((l) => (campo ? l?.[campo] : 1)));
  });
  return soma;
}

function contarSeries(linhas, series) {
  const soma = {};
  series.forEach((serie) => {
    soma[serie.chave] = (linhas ?? []).length;
  });
  return soma;
}

function pesoDaCategoria(categoria, series) {
  return series.reduce((maior, s) => Math.max(maior, Math.abs(categoria[s.chave] ?? 0)), 0);
}

/**
 * Categorias do gráfico: os grupos do relatório quando ele tem mais de um, ou o
 * agrupamento pela primeira coluna de texto quando o resultado é uma lista só.
 */
function categoriasDoResultado(resultado, coluna, series) {
  const contando = !coluna;
  const acumular = contando ? contarSeries : (linhas) => somarSeries(linhas, series, coluna);

  const nomeados = gruposComNome(resultado);
  if (nomeados.length > 1) {
    return {
      rotulo: resultado.rotuloGrupo ?? "Categoria",
      itens: nomeados.map((g) => ({
        nome: String(g.nome),
        ...acumular(g.linhas, series),
      })),
    };
  }

  const texto = colunaDeTexto(resultado);
  if (!texto) return { rotulo: "Categoria", itens: [] };

  const mapa = new Map();
  todasAsLinhas(resultado).forEach((linha) => {
    const nome = String(linha?.[texto.chave] ?? "").trim() || "--";
    if (!mapa.has(nome)) mapa.set(nome, []);
    mapa.get(nome).push(linha);
  });

  return {
    rotulo: texto.label,
    itens: [...mapa.entries()].map(([nome, linhas]) => ({ nome, ...acumular(linhas, series) })),
  };
}

/**
 * Agrupa a cauda em "Outros" -- uma rosca com trinta fatias não informa nada, e
 * barras demais não caberiam no eixo. O que sobrou continua na tabela.
 */
function limitar(itens, series, maximo) {
  if (itens.length <= maximo) return { itens, agrupados: 0 };
  const principais = itens.slice(0, maximo - 1);
  const resto = itens.slice(maximo - 1);
  const outros = { nome: ROTULO_OUTROS };
  series.forEach((s) => {
    outros[s.chave] = somar(resto.map((i) => i[s.chave]));
  });
  return { itens: [...principais, outros], agrupados: resto.length };
}

/* -------------------------------------------------------------------------
 * Evolução no tempo
 * ---------------------------------------------------------------------- */

function evolucaoPorData(resultado, coluna, series, colunaData) {
  const mapa = new Map();
  todasAsLinhas(resultado).forEach((linha) => {
    const iso = soData(linha?.[colunaData.chave]);
    if (!/^\d{4}-\d{2}/.test(iso)) return;
    const mes = iso.slice(0, 7);
    if (!mapa.has(mes)) mapa.set(mes, []);
    mapa.get(mes).push(linha);
  });

  return [...mapa.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mes, linhas]) => ({
      nome: rotuloDoMes(`${mes}-01`),
      ...(coluna ? somarSeries(linhas, series, coluna) : contarSeries(linhas, series)),
    }));
}

/** Relatórios já agrupados por mês (ex.: fornecedores por período) viram linha direto. */
function evolucaoPorGrupoMensal(resultado, coluna, series) {
  const nomeados = gruposComNome(resultado);
  const mensal = nomeados.every((g) => /^[A-Za-zÀ-ÿ]+ de \d{4}$/.test(String(g.nome).trim()));
  if (!mensal || nomeados.length < 2) return [];
  return nomeados.map((g) => ({
    nome: String(g.nome),
    ...(coluna ? somarSeries(g.linhas, series, coluna) : contarSeries(g.linhas, series)),
  }));
}

/* -------------------------------------------------------------------------
 * Montagem
 * ---------------------------------------------------------------------- */

/**
 * Traduz um resultado de relatório nas séries que o gráfico desenha.
 * Devolve `null` quando não há o que mostrar (nenhuma categoria com valor).
 */
export function dadosDoGrafico(resultado) {
  if (!resultado || (resultado.registros ?? 0) === 0) return null;

  const coluna = colunaDeValor(resultado);
  const series = seriesDoResultado(resultado, coluna);
  const rotuloValor = coluna?.label ?? "Registros";
  const tipoValor = coluna?.tipo ?? "numero";

  const categorias = categoriasDoResultado(resultado, coluna, series);
  const ordenadas = [...categorias.itens].sort(
    (a, b) => pesoDaCategoria(b, series) - pesoDaCategoria(a, series)
  );
  const comValor = ordenadas.filter((item) => pesoDaCategoria(item, series) !== 0);
  const base = comValor.length > 0 ? comValor : ordenadas;
  if (base.length === 0) return null;

  const barras = limitar(base, series, MAX_CATEGORIAS_BARRAS);

  const colunaData = colunaDeData(resultado);
  const evolucao = colunaData
    ? evolucaoPorData(resultado, coluna, series, colunaData)
    : evolucaoPorGrupoMensal(resultado, coluna, series);

  // Rosca só faz sentido para uma série (proporção de um total) e com valores
  // positivos -- fatia negativa não tem como ocupar ângulo.
  const somenteUma = series.length === 1;
  const positivos = base.filter((item) => (item[series[0].chave] ?? 0) > 0);
  const rosca = somenteUma && positivos.length > 1 ? limitar(positivos, series, MAX_CATEGORIAS_ROSCA) : null;

  const tipos = [];
  if (barras.itens.length > 0) tipos.push("barras");
  if (evolucao.length > 1) tipos.push("linhas");
  if (rosca) tipos.push("rosca");
  if (tipos.length === 0) return null;

  return {
    tipos,
    tipoValor,
    rotuloValor,
    rotuloCategoria: categorias.rotulo,
    series,
    categorias: barras.itens,
    categoriasAgrupadas: barras.agrupados,
    evolucao,
    rosca: rosca?.itens ?? [],
    roscaAgrupadas: rosca?.agrupados ?? 0,
    totalCategorias: base.length,
  };
}

/** Valor formatado do jeito que ele aparece na tabela (tooltip e rótulos). */
export function formatarValorGrafico(valor, tipoValor) {
  if (tipoValor === "moeda") return formatBRL(valor);
  const numero = Number(valor ?? 0);
  return Number.isFinite(numero) ? numero.toLocaleString("pt-BR") : "0";
}

/** Eixo curto: "R$ 1,2 mi", "R$ 340 mil" -- o valor exato fica no tooltip. */
export function formatarEixo(valor, tipoValor) {
  const numero = Number(valor ?? 0);
  if (!Number.isFinite(numero)) return "0";
  const prefixo = tipoValor === "moeda" ? "R$ " : "";
  const sinal = numero < 0 ? "-" : "";
  const absoluto = Math.abs(numero);
  const curto = (n, sufixo) =>
    `${sinal}${prefixo}${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${sufixo}`;
  if (absoluto >= 1_000_000_000) return curto(absoluto / 1_000_000_000, "bi");
  if (absoluto >= 1_000_000) return curto(absoluto / 1_000_000, "mi");
  if (absoluto >= 1_000) return curto(absoluto / 1_000, "mil");
  return `${sinal}${prefixo}${absoluto.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}
