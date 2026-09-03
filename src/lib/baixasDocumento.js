import * as XLSX from "xlsx";
import { gerarPdfRelatorio, imprimirRelatorio } from "./relatoriosDocumento";
import { montarCabecalho, resumoDeFiltros, textoPeriodo } from "./relatoriosCabecalho";
import { agoraBR } from "./saldosDocumento";
import { formatarData, hojeISO, situacaoDaNota } from "./notasFornecedor";
import { formatBRL, marcarCelulasDeMoeda } from "./moeda";
import {
  baixasDaNota,
  centavos,
  descricaoDaNota,
  nomeDoFornecedor,
  numeroDaNota,
  resumoDaNota,
  totaisDasNotas,
} from "./regrasBaixas";

// Impressão, PDF e planilha da aba "Baixas de Pagamentos".
//
// Nada de formatação nova: as notas e as baixas viram o mesmo "resultado" que a
// Central de Relatórios monta (colunas declaradas + linhas prontas), e a geração
// dos documentos é a mesma das telas de Saldos, Certidões e Relatórios --
// inclusive a compactação até caber no número de páginas e o cabeçalho
// padronizado com instituição, período, filtros, emissão e emissor.
//
// O documento sai sempre com o recorte que está na tela: o fornecedor escolhido
// e os filtros aplicados definem as linhas, o título e o resumo do topo.
//
// A planilha é montada aqui, e não pelo exportador genérico de relatórios,
// porque esta tem duas abas (notas e baixas) e subtotais por bloco. O formato de
// moeda das células vem do utilitário compartilhado (lib/moeda.js), o mesmo que
// o exportador genérico e a planilha de Programação usam.
//
// Este arquivo só lê. Nenhuma linha aqui movimenta saldo de conta: os valores
// impressos são o valor da nota, o que já foi baixado e o que continua em
// aberto.

export const TITULO_NOTAS = "Notas em aberto por fornecedor";
export const TITULO_BAIXAS = "Baixas de pagamentos registradas";

/** Visões que a tela pode imprimir. */
export const VISAO_NOTAS = "notas";
export const VISAO_BAIXAS = "baixas";

/**
 * Colunas da listagem de notas, na ordem da tela: Vencimento | Nota |
 * Descrição | Valor original | Baixado | Em aberto. As três últimas somam --
 * o subtotal de cada bloco e o total geral saem delas.
 */
export const COLUNAS_NOTAS = [
  { chave: "vencimento", label: "Vencimento", peso: 11 },
  { chave: "emissao", label: "Emissão", peso: 10 },
  { chave: "nota", label: "Nota fiscal", peso: 14 },
  { chave: "descricao", label: "Descrição", peso: 20 },
  { chave: "situacao", label: "Situação", peso: 12 },
  { chave: "valor", label: "Valor original", peso: 12, tipo: "moeda", somavel: true },
  { chave: "baixado", label: "Já baixado", peso: 11, tipo: "moeda", somavel: true },
  { chave: "aberto", label: "Em aberto", peso: 12, tipo: "moeda", somavel: true },
];

/** Colunas do histórico de baixas: uma linha por baixa registrada. */
export const COLUNAS_BAIXAS = [
  { chave: "data", label: "Pagamento", peso: 11 },
  { chave: "nota", label: "Nota fiscal", peso: 13 },
  { chave: "valor", label: "Valor pago", peso: 13, tipo: "moeda", somavel: true },
  { chave: "conta", label: "Conta bancária", peso: 20 },
  { chave: "usuario", label: "Registrada por", peso: 15 },
  { chave: "status", label: "Situação", peso: 10 },
  { chave: "observacao", label: "Observação", peso: 18 },
];

/**
 * Quantas linhas caberiam numa folha sem apertar a fonte. O limite de páginas
 * sai daí: uma lista curta é impressa espaçada e uma longa continua compactada,
 * em vez de esmagar centenas de linhas em duas folhas.
 */
const LINHAS_POR_PAGINA = 34;

function maxPaginas(quantidade) {
  return Math.max(2, Math.ceil(quantidade / LINHAS_POR_PAGINA));
}

export function nomeDoArquivo(visao = VISAO_NOTAS) {
  const parte = visao === VISAO_BAIXAS ? "baixas" : "notas-em-aberto";
  return `${parte}-${hojeISO()}`;
}

const ROTULO_STATUS = { efetivada: "Efetivada", estornada: "Estornada" };

function statusDaBaixa(baixa) {
  const chave = String(baixa?.status ?? "efetivada");
  return ROTULO_STATUS[chave] ?? chave;
}

function textoDaConta(conta) {
  if (!conta) return "--";
  const nome = String(conta.nome_conta ?? "").trim() || `Conta ${conta.id}`;
  const banco = String(conta.bancos?.nome ?? "").trim();
  return banco ? `${nome} · ${banco}` : nome;
}

/** Índice por id, para resolver conta, usuário e nota sem varrer as listas. */
function porId(lista = []) {
  const mapa = new Map();
  lista.forEach((item) => mapa.set(String(item?.id ?? ""), item));
  return mapa;
}

/* -------------------------------------------------------------------------
 * Linhas dos documentos
 * ---------------------------------------------------------------------- */

/** Uma linha de documento por nota da listagem, com os valores já conferidos. */
export function linhasDeNotas(notas = [], { situacoes = [], hoje = hojeISO() } = {}) {
  return notas.map((nota) => {
    const resumo = resumoDaNota(nota);
    return {
      vencimento: nota.data_vencimento ? formatarData(nota.data_vencimento) : "--",
      emissao: nota.data_nota_fiscal ? formatarData(nota.data_nota_fiscal) : "--",
      nota: numeroDaNota(nota),
      descricao: descricaoDaNota(nota) || "--",
      situacao: situacaoDaNota(nota, situacoes, hoje).rotulo,
      valor: resumo.valorTotal,
      baixado: resumo.valorBaixado,
      aberto: resumo.valorEmAberto,
    };
  });
}

/**
 * Uma linha de documento por baixa. A nota, a conta e o nome de quem registrou
 * vêm das listas que a tela já carregou -- os mesmos registros, sem consulta
 * nova e sem duplicar dado.
 */
export function linhasDeBaixas(baixas = [], { notas = [], contas = [], usuarios = [] } = {}) {
  const indiceNotas = porId(notas);
  const indiceContas = porId(contas);
  const indiceUsuarios = porId(usuarios);

  return baixas.map((baixa) => {
    const nota = indiceNotas.get(String(baixa.valor_em_aberto_id ?? ""));
    const usuario = indiceUsuarios.get(String(baixa.usuario_id ?? ""));
    const observacao = String(baixa.observacao ?? "").trim();
    const motivo = String(baixa.motivo_estorno ?? "").trim();

    return {
      data: baixa.data_pagamento ? formatarData(baixa.data_pagamento) : "--",
      nota: nota ? numeroDaNota(nota) : "--",
      valor: centavos(baixa.valor_pago),
      conta: textoDaConta(indiceContas.get(String(baixa.conta_id ?? ""))),
      usuario: String(usuario?.nome_completo ?? "").trim() || "--",
      status: statusDaBaixa(baixa),
      observacao: motivo ? `Estorno: ${motivo}` : observacao || "--",
    };
  });
}

function somar(linhas, colunas) {
  const totais = {};
  colunas
    .filter((c) => c.somavel)
    .forEach((c) => {
      totais[c.chave] = centavos(linhas.reduce((acc, linha) => acc + (Number(linha[c.chave]) || 0), 0));
    });
  return totais;
}

/* -------------------------------------------------------------------------
 * Resultados (o que impressão, PDF e planilha consomem)
 * ---------------------------------------------------------------------- */

/** As notas em aberto no formato dos documentos, com subtotal e total geral. */
export function resultadoDeNotas(notas = [], { titulo = TITULO_NOTAS, situacoes = [], hoje = hojeISO() } = {}) {
  const linhas = linhasDeNotas(notas, { situacoes, hoje });
  const totais = somar(linhas, COLUNAS_NOTAS);

  return {
    nome: titulo,
    colunas: COLUNAS_NOTAS,
    grupos: [{ nome: null, linhas, totais }],
    registros: linhas.length,
    totais,
    campoTotal: "aberto",
  };
}

/**
 * As baixas no formato dos documentos. Com `agrupado`, sai um bloco por nota --
 * o mesmo recorte que a tela mostra quando a nota é expandida --, cada bloco com
 * o subtotal do que já foi pago naquela nota.
 */
export function resultadoDeBaixas(
  baixas = [],
  { titulo = TITULO_BAIXAS, agrupado = false, notas = [], contas = [], usuarios = [] } = {},
) {
  const contexto = { notas, contas, usuarios };
  const grupos = agrupado
    ? notas
        .map((nota) => {
          const linhas = linhasDeBaixas(baixasDaNota(nota, baixas), contexto);
          const resumo = resumoDaNota(nota);
          return {
            nome: `Nota ${numeroDaNota(nota)} · em aberto ${formatarValorTexto(resumo.valorEmAberto)}`,
            linhas,
            totais: somar(linhas, COLUNAS_BAIXAS),
          };
        })
        .filter((grupo) => grupo.linhas.length > 0)
        .concat(gruposRestantes(baixas, notas, contexto))
    : [
        (() => {
          const linhas = linhasDeBaixas(baixas, contexto);
          return { nome: null, linhas, totais: somar(linhas, COLUNAS_BAIXAS) };
        })(),
      ];

  const registros = grupos.reduce((acc, grupo) => acc + grupo.linhas.length, 0);
  const totais = {
    valor: centavos(grupos.reduce((acc, grupo) => acc + (grupo.totais.valor ?? 0), 0)),
  };

  return {
    nome: titulo,
    colunas: COLUNAS_BAIXAS,
    grupos,
    registros,
    totais,
    campoTotal: "valor",
  };
}

/**
 * Baixas que não caíram em nenhum bloco de nota -- é o caso da nota que já foi
 * quitada e saiu da listagem. Elas continuam no documento: o histórico do
 * fornecedor não some porque a nota fechou.
 */
function gruposRestantes(baixas, notas, contexto) {
  const cobertas = new Set(notas.map((nota) => String(nota.id ?? "")));
  const sobrando = baixas.filter((baixa) => !cobertas.has(String(baixa.valor_em_aberto_id ?? "")));
  if (sobrando.length === 0) return [];

  const linhas = linhasDeBaixas(sobrando, contexto);
  return [{ nome: "Notas fora do recorte atual", linhas, totais: somar(linhas, COLUNAS_BAIXAS) }];
}

/** Moeda em texto para os títulos dos blocos (o resto usa as colunas de moeda). */
function formatarValorTexto(valor) {
  return formatBRL(valor);
}

/* -------------------------------------------------------------------------
 * Cabeçalho e identificação do recorte
 * ---------------------------------------------------------------------- */

/** Título do documento a partir da visão e do recorte que está valendo na tela. */
export function tituloDoRecorte({ visao = VISAO_NOTAS, filtros } = {}) {
  if (visao === VISAO_BAIXAS) return TITULO_BAIXAS;
  if (filtros?.somenteVencidas === true) return "Notas em aberto já vencidas";
  return TITULO_NOTAS;
}

/** Período do documento: o intervalo de vencimento pedido nos filtros. */
export function periodoDosFiltros(filtros, { visao = VISAO_NOTAS } = {}) {
  const periodo = textoPeriodo(filtros?.inicio, filtros?.fim);
  if (!periodo) {
    return visao === VISAO_BAIXAS ? "Todas as baixas registradas" : "Todas as notas em aberto";
  }
  return visao === VISAO_BAIXAS ? `Pagamento: ${periodo}` : `Vencimento: ${periodo}`;
}

/**
 * Resumo dos filtros usados: "Fornecedor: XYZ | Conta: Banco do Brasil". O
 * período fica fora daqui porque tem linha própria no cabeçalho.
 */
export function resumoDosFiltros(filtros, { fornecedores = [], contas = [], situacoes = [] } = {}) {
  const f = filtros ?? {};

  const fornecedor = f.fornecedorId
    ? nomeDoFornecedor(fornecedores.find((item) => String(item.id) === String(f.fornecedorId))) ||
      "Fornecedor selecionado"
    : "";
  const conta = f.contaId
    ? textoDaConta(contas.find((item) => String(item.id) === String(f.contaId))) || "Conta selecionada"
    : "";
  const situacao = f.situacao
    ? situacoes.find((s) => s.value === f.situacao)?.label ??
      situacaoDaNota({ situacao: f.situacao }, situacoes).rotuloGravado
    : "";

  const texto = resumoDeFiltros([
    { label: "Fornecedor", valor: fornecedor },
    { label: "Conta", valor: conta },
    { label: "Nota", valor: String(f.busca ?? "").trim() },
    { label: "Situação", valor: situacao },
    { label: "Recorte", valor: f.somenteVencidas === true ? "Somente vencidas" : "" },
  ]);

  return texto || "Nenhum filtro aplicado";
}

/** Cabeçalho padronizado: instituição, recorte, filtros, emissão e emissor. */
export function cabecalhoDasBaixas({
  titulo,
  visao = VISAO_NOTAS,
  filtros,
  fornecedores,
  contas,
  situacoes,
  usuario,
  geradoEm,
} = {}) {
  return montarCabecalho({
    relatorio: titulo ?? tituloDoRecorte({ visao, filtros }),
    periodo: periodoDosFiltros(filtros, { visao }),
    filtros: resumoDosFiltros(filtros, { fornecedores, contas, situacoes }),
    geradoEm: geradoEm ?? agoraBR(),
    usuario,
  });
}

/**
 * O documento pronto para os três destinos. `dados` é o que a tela tem em mão:
 * as notas e as baixas já filtradas, as listas de apoio e os filtros aplicados.
 */
function documento(dados = {}) {
  const {
    visao = VISAO_NOTAS,
    notas = [],
    // Para o histórico das baixas vale a lista completa de notas do fornecedor
    // (inclusive as já quitadas), senão a baixa que quitou a nota sairia do
    // documento junto com ela.
    notasTodas = notas,
    baixas = [],
    contas = [],
    usuarios = [],
    fornecedores = [],
    situacoes = [],
    filtros,
    usuario,
    geradoEm,
    agrupado = false,
    hoje = hojeISO(),
  } = dados;

  const titulo = tituloDoRecorte({ visao, filtros });
  const resultado =
    visao === VISAO_BAIXAS
      ? resultadoDeBaixas(baixas, { titulo, agrupado, notas: notasTodas, contas, usuarios })
      : resultadoDeNotas(notas, { titulo, situacoes, hoje });

  return {
    titulo,
    resultado,
    cabecalho: cabecalhoDasBaixas({
      titulo,
      visao,
      filtros,
      fornecedores,
      contas,
      situacoes,
      usuario,
      geradoEm,
    }),
    maxPaginas: maxPaginas(resultado.registros),
  };
}

/* -------------------------------------------------------------------------
 * Impressão e PDF
 * ---------------------------------------------------------------------- */

export function imprimirBaixas(dados) {
  const { titulo, resultado, cabecalho, maxPaginas: paginas } = documento(dados);
  if (resultado.registros === 0) return false;
  imprimirRelatorio({ titulo, resultado, cabecalho, maxPaginas: paginas });
  return true;
}

export function gerarPdfBaixas(dados) {
  const { titulo, resultado, cabecalho, maxPaginas: paginas } = documento(dados);
  if (resultado.registros === 0) return false;
  gerarPdfRelatorio({
    titulo,
    resultado,
    cabecalho,
    maxPaginas: paginas,
    arquivo: `${nomeDoArquivo(dados?.visao)}.pdf`,
  });
  return true;
}

/* -------------------------------------------------------------------------
 * Planilha
 * ---------------------------------------------------------------------- */

/**
 * Uma aba da planilha a partir de um `resultado`: identificação no topo, um
 * bloco por grupo e subtotal em cada bloco. As células de valor saem como
 * NÚMERO com o formato de moeda brasileiro, para que a planilha continue
 * somando e a leitura continue em reais.
 */
function abaDoResultado({ resultado, cabecalho }) {
  const colunas = resultado.colunas;
  const indicesMoeda = colunas.map((c, i) => (c.tipo === "moeda" ? i : -1)).filter((i) => i >= 0);
  const linhas = [];
  const moeda = [];
  const negrito = [];

  const identificacao = [
    [cabecalho?.instituicao ?? ""],
    [cabecalho?.relatorio ?? resultado.nome],
    [cabecalho?.periodo ? `Período: ${cabecalho.periodo}` : ""],
    [cabecalho?.filtros ? `Filtros: ${cabecalho.filtros}` : ""],
    [
      [
        cabecalho?.geradoEm ? `Gerado em ${cabecalho.geradoEm}` : "",
        cabecalho?.usuario ? `Emitido por ${cabecalho.usuario}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    ],
    [],
  ];
  identificacao.forEach((linha) => linhas.push(linha));
  negrito.push({ linha: 1, coluna: 0 });

  resultado.grupos
    .filter((grupo) => grupo.linhas.length > 0)
    .forEach((grupo) => {
      if (grupo.nome) {
        linhas.push([grupo.nome]);
        negrito.push({ linha: linhas.length - 1, coluna: 0 });
      }

      linhas.push(colunas.map((c) => c.label));
      const cabecalhoTabela = linhas.length - 1;
      colunas.forEach((_, coluna) => negrito.push({ linha: cabecalhoTabela, coluna }));

      grupo.linhas.forEach((linha) => {
        linhas.push(colunas.map((c) => (c.tipo === "moeda" ? Number(linha[c.chave]) || 0 : linha[c.chave] ?? "")));
        indicesMoeda.forEach((coluna) => moeda.push({ linha: linhas.length - 1, coluna }));
      });

      const rotulo = grupo.nome ? "Subtotal" : "Total geral";
      linhas.push(
        colunas.map((c, i) => {
          if (i === 0) return `${rotulo} (${grupo.linhas.length})`;
          return c.somavel ? Number(grupo.totais?.[c.chave]) || 0 : "";
        }),
      );
      const linhaSubtotal = linhas.length - 1;
      colunas.forEach((c, coluna) => {
        negrito.push({ linha: linhaSubtotal, coluna });
        if (c.tipo === "moeda" && c.somavel) moeda.push({ linha: linhaSubtotal, coluna });
      });

      linhas.push([]);
    });

  // Com mais de um bloco, cada um fecha com o próprio subtotal e a planilha
  // fecha com o total geral, para bater com o rodapé da impressão.
  const blocos = resultado.grupos.filter((grupo) => grupo.linhas.length > 0);
  if (blocos.length > 1) {
    linhas.push(
      colunas.map((c, i) => {
        if (i === 0) return `TOTAL GERAL (${resultado.registros})`;
        return c.somavel ? Number(resultado.totais?.[c.chave]) || 0 : "";
      }),
    );
    const linhaTotal = linhas.length - 1;
    colunas.forEach((c, coluna) => {
      negrito.push({ linha: linhaTotal, coluna });
      if (c.tipo === "moeda" && c.somavel) moeda.push({ linha: linhaTotal, coluna });
    });
  }

  const planilha = XLSX.utils.aoa_to_sheet(linhas);

  marcarCelulasDeMoeda(planilha, moeda);
  negrito.forEach(({ linha, coluna }) => {
    const celula = planilha[XLSX.utils.encode_cell({ r: linha, c: coluna })];
    if (!celula) return;
    celula.s = { ...(celula.s ?? {}), font: { ...(celula.s?.font ?? {}), bold: true } };
  });

  planilha["!cols"] = colunas.map((c) => ({ wch: Math.max(12, Math.round((c.peso ?? 12) * 1.5)) }));

  return planilha;
}

/**
 * Planilha da tela, com o mesmo recorte dos filtros aplicados. O arquivo leva as
 * duas leituras da aba: as notas em aberto e as baixas já registradas, cada uma
 * na sua guia -- quem exporta não precisa gerar dois arquivos.
 */
export function exportarExcelBaixas(dados = {}) {
  const notas = documento({ ...dados, visao: VISAO_NOTAS });
  const baixas = documento({ ...dados, visao: VISAO_BAIXAS });
  if (notas.resultado.registros === 0 && baixas.resultado.registros === 0) return false;

  const livro = XLSX.utils.book_new();
  if (notas.resultado.registros > 0) {
    XLSX.utils.book_append_sheet(livro, abaDoResultado(notas), "Notas em aberto");
  }
  if (baixas.resultado.registros > 0) {
    XLSX.utils.book_append_sheet(livro, abaDoResultado(baixas), "Baixas");
  }

  XLSX.writeFile(livro, `${nomeDoArquivo(dados.visao)}.xlsx`);
  return true;
}
