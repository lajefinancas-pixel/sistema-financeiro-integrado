// Relatórios de Patrocínios, Aluguéis e Bandas.
//
// Este arquivo é só cálculo puro (sem banco e sem tela): as colunas, os filtros,
// as linhas e a ordem de cada um dos três relatórios. Quem desenha a tela, quem
// imprime, quem gera o PDF e quem exporta a planilha usam o mesmo resultado, do
// mesmo jeito que já acontece com os relatórios que existiam antes.
//
// PAGO E SALDO CONTINUAM CALCULADOS. As linhas do relatório saem de
// `resumoFinanceiroDoRegistro`, a MESMA função que a listagem de cada área usa,
// que soma as baixas das NFs vinculadas ao registro. Nenhuma coluna paralela de
// valor pago é lida ou criada aqui -- é por isso que o total do relatório bate
// com o da área e com a aba de Baixas.
//
// Os filtros também não inventam critério: quem decide se um registro atende a
// Fornecedor, Secretaria, Situação, faixa de valores, objeto, banda ou evento é
// `registroAtendeFiltro`, de lib/areasFornecedores.js -- a mesma função da
// listagem. O único filtro que nasce aqui é o de período, que a listagem não
// tem, e ele começa vazio: sem período informado, o relatório mostra (e soma)
// exatamente o que a tela da área mostra.

import {
  SITUACOES_AREA,
  cadastroDoRegistro,
  nomeDoFornecedorDoRegistro,
  registroAtendeFiltro,
  resumoFinanceiroDoRegistro,
  situacaoAreaInfo,
  situacaoPagamentoDoRegistro,
  textoDoCampo,
} from "./areasFornecedores.js";
import { apelidoDoFornecedor } from "./nomesFornecedor.js";
import { formatBRL } from "./moeda.js";

/**
 * A data que responde pelo período em cada área, com o nome que a pessoa lê.
 *
 * Cada área tem a sua data natural: o patrocínio é datado pelo cadastro, o
 * aluguel pelo início da vigência e a contratação da banda pela apresentação. A
 * `referencia` diz qual é, no painel de filtros e no cabeçalho dos documentos,
 * para que ninguém precise adivinhar o que o período está recortando.
 */
const PERIODO_DA_AREA = {
  patrocinios: { campo: "criado_em", referencia: "data de cadastro" },
  alugueis: { campo: "data_inicio", referencia: "data de início do aluguel" },
  bandas: { campo: "data_apresentacao", referencia: "data da apresentação" },
};

const PERIODO_PADRAO = { campo: "criado_em", referencia: "data de cadastro" };

export function periodoDaArea(area) {
  const periodo = PERIODO_DA_AREA[area?.id] ?? PERIODO_PADRAO;
  return { ...periodo, rotulo: `Período (${periodo.referencia})` };
}

/** Filtros específicos de cada área, acrescidos aos comuns. */
const FILTROS_ESPECIFICOS = {
  patrocinios: [
    { chave: "evento", rotulo: "Evento / Finalidade", tipo: "texto", campos: ["evento"] },
  ],
  alugueis: [
    { chave: "objeto", rotulo: "Objeto alugado", tipo: "texto", campos: ["objeto", "descricao"] },
  ],
  bandas: [
    { chave: "banda", rotulo: "Banda / Artista", tipo: "texto", campos: ["banda"] },
    { chave: "evento", rotulo: "Evento", tipo: "texto", campos: ["evento"] },
  ],
};

/**
 * Os filtros recolhíveis do relatório, na ordem em que aparecem no painel:
 * período, secretaria, fornecedor, situação, faixa de valores e, por último, os
 * específicos da área.
 *
 * O filtro de fornecedor olha o nome oficial, o fantasia, o documento e o
 * apelido de uma vez -- é o mesmo conteúdo que a busca da listagem enxerga.
 */
export function filtrosDoRelatorioDaArea(area) {
  if (!area) return [];
  return [
    { chave: "periodo", rotulo: periodoDaArea(area).rotulo, tipo: "periodo" },
    { chave: "secretaria", rotulo: "Secretaria", tipo: "secretaria" },
    {
      chave: "fornecedor",
      rotulo: "Fornecedor",
      tipo: "texto",
      campos: ["fornecedor", "apelido"],
    },
    { chave: "situacao", rotulo: "Situação", tipo: "situacao" },
    { chave: "valor", rotulo: "Faixa de valores", tipo: "faixaValor" },
    ...(FILTROS_ESPECIFICOS[area.id] ?? []),
  ];
}

/** As chaves de estado de um filtro (a faixa e o período ocupam duas cada). */
function chavesDoFiltro(filtro) {
  if (filtro.tipo === "faixaValor") return [`${filtro.chave}Min`, `${filtro.chave}Max`];
  if (filtro.tipo === "periodo") return ["periodoInicio", "periodoFim"];
  return [filtro.chave];
}

/**
 * O estado inicial dos filtros (e o "Limpar filtros"): tudo vazio.
 *
 * O período começa em branco de propósito -- assim o relatório abre com os
 * mesmos registros e os mesmos totais da tela da área, sem recorte nenhum.
 */
export function filtrosVaziosDoRelatorio(area) {
  const vazios = {};
  filtrosDoRelatorioDaArea(area).forEach((filtro) => {
    chavesDoFiltro(filtro).forEach((chave) => {
      vazios[chave] = "";
    });
  });
  return vazios;
}

function textoLimpo(valor) {
  return String(valor ?? "").trim();
}

/** Quantos filtros estão preenchidos (o contador do PainelFiltros). */
export function totalFiltrosDoRelatorio(area, filtros = {}) {
  return filtrosDoRelatorioDaArea(area).reduce((total, filtro) => {
    const preenchido = chavesDoFiltro(filtro).some((chave) => textoLimpo(filtros[chave]) !== "");
    return total + (preenchido ? 1 : 0);
  }, 0);
}

/** Só a parte "AAAA-MM-DD" da data do registro (comparação, não formatação). */
function dataDoRegistro(area, registro) {
  return String(registro?.[periodoDaArea(area).campo] ?? "").slice(0, 10);
}

/**
 * O registro está dentro do período informado?
 *
 * Sem início e sem fim, todo registro entra. Com período informado, registro
 * sem essa data fica fora -- não há como afirmar que ele pertence ao recorte.
 */
function atendePeriodo(area, registro, filtros = {}) {
  const inicio = textoLimpo(filtros.periodoInicio);
  const fim = textoLimpo(filtros.periodoFim);
  if (inicio === "" && fim === "") return true;
  const data = dataDoRegistro(area, registro);
  if (data === "") return false;
  if (inicio !== "" && data < inicio) return false;
  if (fim !== "" && data > fim) return false;
  return true;
}

/** Os registros que o relatório mostra, com os filtros do painel aplicados. */
export function filtrarRegistrosDoRelatorio(area, registros = [], filtros = {}) {
  const descritores = filtrosDoRelatorioDaArea(area).filter((f) => f.tipo !== "periodo");
  return (registros ?? []).filter((registro) => {
    if (!atendePeriodo(area, registro, filtros)) return false;
    return descritores.every((filtro) => registroAtendeFiltro(area, registro, filtro, filtros));
  });
}

/* -------------------------------------------------------------------------
 * Colunas e linhas
 * ---------------------------------------------------------------------- */

// Largura relativa de cada coluna nos documentos. As colunas são as MESMAS da
// listagem da área (menos "Ações", que é botão de tela e não existe em papel).
const PESOS = {
  banda: 20,
  fornecedor: 22,
  apelido: 13,
  nome: 20,
  evento: 16,
  objetoDescricao: 20,
  secretaria: 16,
  valor: 14,
  pago: 14,
  saldo: 14,
  situacao: 11,
  situacaoPagamento: 13,
};

/** As colunas da listagem da área, no formato que a Central de Relatórios usa. */
export function colunasDoRelatorioDaArea(area) {
  return (area?.colunas ?? [])
    .filter((coluna) => coluna.chave !== "acoes")
    .map((coluna) => ({
      chave: coluna.chave,
      label: coluna.rotulo,
      peso: PESOS[coluna.chave] ?? 14,
      // Todas as colunas numéricas destas áreas são dinheiro (valor, pago, saldo).
      ...(coluna.numerico ? { tipo: "moeda", somavel: true } : {}),
    }));
}

// Colunas montadas à mão na linha (nome do fornecedor exibido, apelido,
// secretaria, o par objeto/descrição, dinheiro e as duas situações). O resto
// vem direto do registro, pela mesma leitura da listagem.
const COLUNAS_PRONTAS = [
  "acoes",
  "fornecedor",
  "apelido",
  "secretaria",
  "objetoDescricao",
  "valor",
  "pago",
  "saldo",
  "situacao",
  "situacaoPagamento",
];

function colunasProprias(area) {
  return (area?.colunas ?? [])
    .filter((coluna) => !COLUNAS_PRONTAS.includes(coluna.chave))
    .map((coluna) => coluna.chave);
}

/**
 * Uma linha do relatório.
 *
 * Valor, Pago e Saldo saem de `resumoFinanceiroDoRegistro` -- as baixas das NFs
 * vinculadas --, e a situação do pagamento de `situacaoPagamentoDoRegistro`.
 * São as mesmas funções que a linha da listagem usa, então relatório e tela não
 * podem divergir.
 */
export function linhaDoRelatorio(area, registro) {
  const resumo = resumoFinanceiroDoRegistro(registro);
  const linha = {
    id: registro?.id,
    fornecedor: nomeDoFornecedorDoRegistro(registro),
    apelido: apelidoDoFornecedor(cadastroDoRegistro(registro)),
    secretaria: textoDoCampo(registro, "secretaria"),
    objetoDescricao: [registro?.objeto, registro?.descricao].filter(Boolean).join(" — "),
    valor: resumo.valor,
    pago: resumo.pago,
    saldo: resumo.saldo,
    situacao: situacaoAreaInfo(registro?.situacao).label,
    situacaoPagamento: situacaoPagamentoDoRegistro(registro).label,
  };
  colunasProprias(area).forEach((chave) => {
    linha[chave] = textoDoCampo(registro, chave);
  });
  return linha;
}

/**
 * A ordem alfabética de cada relatório: patrocínios e aluguéis pelo fornecedor
 * EXIBIDO (apelido quando existe, senão a razão social), bandas pelo nome da
 * banda/artista. O segundo critério só desempata.
 */
const ORDEM = {
  patrocinios: ["fornecedor", "nome"],
  alugueis: ["fornecedor", "objetoDescricao"],
  bandas: ["banda", "fornecedor"],
};

function compararTexto(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""), "pt-BR", { sensitivity: "base" });
}

export function ordenarLinhasDoRelatorio(area, linhas = []) {
  const chaves = ORDEM[area?.id] ?? ["fornecedor"];
  return [...linhas].sort((a, b) => {
    for (const chave of chaves) {
      const comparacao = compararTexto(a?.[chave], b?.[chave]);
      if (comparacao !== 0) return comparacao;
    }
    return 0;
  });
}

/** As linhas do relatório: filtradas e em ordem alfabética. */
export function linhasDoRelatorioDaArea(area, registros = [], filtros = {}) {
  return ordenarLinhasDoRelatorio(
    area,
    filtrarRegistrosDoRelatorio(area, registros, filtros).map((registro) =>
      linhaDoRelatorio(area, registro),
    ),
  );
}

/* -------------------------------------------------------------------------
 * Relação de valores (duas colunas)
 * ---------------------------------------------------------------------- */

/**
 * Qual coluna responde pelo NOME de cada área na relação de duas colunas.
 *
 * É o campo que identifica o registro na tela: o patrocínio é o nome/descrição,
 * o aluguel é o objeto com a descrição e a contratação é a banda/artista -- o
 * fornecedor por trás não vai ao papel, porque a relação é do registro. O valor
 * é sempre o Saldo: é o que ainda falta pagar, o número que o gestor procura.
 */
const RELACAO_DA_AREA = {
  patrocinios: { nome: "nome", rotuloNome: "Patrocínio" },
  alugueis: { nome: "objetoDescricao", rotuloNome: "Descrição do aluguel" },
  bandas: { nome: "banda", rotuloNome: "Banda / Artista" },
};

const RELACAO_PADRAO = { nome: "fornecedor", rotuloNome: "Fornecedor" };

/** As duas colunas da relação de valores da área: `{ nome, valor, rótulos }`. */
export function relacaoDaArea(area) {
  const escolhida = RELACAO_DA_AREA[area?.id] ?? RELACAO_PADRAO;
  return { ...escolhida, valor: "saldo", rotuloValor: "Saldo" };
}

/**
 * Os itens da relação a partir dos registros JÁ FILTRADOS pela tela.
 *
 * Cada item é só `{ nome, valor }`, e o valor é o saldo que a própria listagem
 * mostra -- a mesma `linhaDoRelatorio`, portanto o mesmo
 * `resumoFinanceiroDoRegistro`, que soma as baixas das NFs vinculadas. Nada é
 * recalculado de outro jeito aqui: é isso que faz o total impresso bater com o
 * total da tela.
 */
export function itensDaRelacaoDaArea(area, registros = []) {
  const definicao = relacaoDaArea(area);
  return (registros ?? []).map((registro) => {
    const linha = linhaDoRelatorio(area, registro);
    return { nome: linha[definicao.nome], valor: linha[definicao.valor] };
  });
}

/* -------------------------------------------------------------------------
 * Os filtros em texto (chips da tela e linha de filtros do cabeçalho)
 * ---------------------------------------------------------------------- */

/**
 * Os filtros preenchidos, em texto, um por item: `{ chave, label, valor,
 * chaves }`. `chaves` são as chaves de estado daquele filtro, para que a tela
 * possa remover o chip sem saber como o filtro é guardado.
 *
 * O período NÃO entra aqui: quem o escreve é a tela, com `textoPeriodo`, o
 * mesmo utilitário que os outros relatórios usam no cabeçalho.
 */
export function descricaoDosFiltros(area, filtros = {}, { secretarias = [] } = {}) {
  return filtrosDoRelatorioDaArea(area)
    .filter((filtro) => filtro.tipo !== "periodo")
    .flatMap((filtro) => {
      const chaves = chavesDoFiltro(filtro);

      if (filtro.tipo === "faixaValor") {
        const minimo = textoLimpo(filtros[`${filtro.chave}Min`]);
        const maximo = textoLimpo(filtros[`${filtro.chave}Max`]);
        if (minimo === "" && maximo === "") return [];
        const valor = [
          minimo === "" ? "" : `de ${formatBRL(minimo)}`,
          maximo === "" ? "" : `até ${formatBRL(maximo)}`,
        ]
          .filter((parte) => parte !== "")
          .join(" ");
        return [{ chave: filtro.chave, label: filtro.rotulo, valor, chaves }];
      }

      const escolhido = textoLimpo(filtros[filtro.chave]);
      if (escolhido === "") return [];

      let valor = escolhido;
      if (filtro.tipo === "secretaria") {
        valor =
          (secretarias ?? []).find((s) => String(s.id) === escolhido)?.nome ?? escolhido;
      }
      if (filtro.tipo === "situacao") {
        valor = SITUACOES_AREA.find((s) => s.value === escolhido)?.label ?? escolhido;
      }
      return [{ chave: filtro.chave, label: filtro.rotulo, valor, chaves }];
    });
}
