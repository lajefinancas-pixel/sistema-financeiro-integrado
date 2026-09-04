import { exportarExcelRelatorio, gerarPdfRelatorio, imprimirRelatorio } from "./relatoriosDocumento";
import { montarCabecalho, resumoDeFiltros, textoPeriodo } from "./relatoriosCabecalho";
import { agoraBR } from "./saldosDocumento";
import { formatarData, hojeISO, nomeFornecedor, nomeSecretaria, situacaoInfo } from "./certidoes";
import { ATALHOS, situacaoDaLinha } from "./filtrosCertidoes";
import { ehVigenteNoTipo, temEmissoesConcorrentes } from "./certidoesRegras";

// Impressão, PDF e planilha da tela de Certidões.
//
// Nada de formatação nova: as certidões viram o mesmo "resultado" que a Central de
// Relatórios monta (colunas declaradas + linhas prontas) e a geração dos três
// documentos é a das telas de Saldos, Fornecedores e Relatórios — inclusive o padrão
// de compactação, que reduz a densidade até caber no número de páginas pedido, e o
// cabeçalho padronizado com instituição, período, filtros, emissão e emissor.
//
// O documento sai sempre com o recorte que está na tela: os filtros aplicados no
// momento definem tanto as linhas quanto o título e o resumo do topo. Um recorte de
// "Vencendo em 30 dias" gera "Certidões vencendo nos próximos 30 dias".
//
// A regularidade impressa é a mesma da tela: quando o fornecedor tem mais de uma
// emissão do mesmo tipo, a coluna Situação marca qual é a vigente e qual é anterior
// (regra única em lib/certidoesRegras.js). Nenhuma certidão é omitida do documento.

export const TITULO_PADRAO = "Certidões";

/**
 * Colunas do documento, na ordem pedida: Fornecedor | Documento | Emissão |
 * Vencimento | Situação. Todas de texto — os rótulos de situação já saem daqui
 * prontos para leitura, do jeito que aparecem na listagem.
 */
export const COLUNAS_CERTIDOES = [
  { chave: "fornecedor", label: "Fornecedor", peso: 30 },
  { chave: "documento", label: "Documento", peso: 26 },
  { chave: "emissao", label: "Emissão", peso: 12 },
  { chave: "vencimento", label: "Vencimento", peso: 12 },
  { chave: "situacao", label: "Situação", peso: 14 },
];

/**
 * Quantas linhas caberiam numa folha sem apertar a fonte. O limite de páginas sai
 * daí: uma lista curta é impressa espaçada e uma longa continua compactada, em vez
 * de esmagar centenas de certidões em duas folhas.
 */
const LINHAS_POR_PAGINA = 36;

function maxPaginas(quantidade) {
  return Math.max(2, Math.ceil(quantidade / LINHAS_POR_PAGINA));
}

export function nomeDoArquivo() {
  return `certidoes-${hojeISO()}`;
}

/** "Certidão Federal — nº 12345" (o número entra só quando existe). */
function textoDoDocumento(certidao) {
  if (certidao?.naoCadastrada) return "Nenhum documento cadastrado";
  const tipo = certidao?.tipos_certidao?.nome ?? "--";
  const numero = String(certidao?.numero_documento ?? "").trim();
  return numero ? `${tipo} — nº ${numero}` : tipo;
}

/**
 * Situação impressa. Havendo mais de uma emissão do mesmo tipo, o documento diz
 * qual delas vale: a etiqueta ganha "(vigente)" ou "(anterior)", para que quem
 * lê o papel chegue à mesma conclusão que a tela — a regularidade é a da emissão
 * mais recente.
 */
function textoDaSituacao(certidao) {
  const label = situacaoInfo(situacaoDaLinha(certidao)).label;
  if (certidao?.naoCadastrada || !temEmissoesConcorrentes(certidao)) return label;
  return `${label} (${ehVigenteNoTipo(certidao) ? "vigente" : "anterior"})`;
}

/** Uma linha de documento por certidão da listagem. */
export function linhasDeCertidoes(certidoes) {
  return (certidoes ?? []).map((certidao) => ({
    fornecedor: nomeFornecedor(certidao.fornecedores),
    documento: textoDoDocumento(certidao),
    emissao: certidao.data_emissao ? formatarData(certidao.data_emissao) : "--",
    vencimento: certidao.data_vencimento ? formatarData(certidao.data_vencimento) : "--",
    situacao: textoDaSituacao(certidao),
  }));
}

/**
 * As certidões no formato que a impressão, o PDF e a planilha esperam.
 *
 * Quando a tela está com a visão "Agrupar por fornecedor", o documento sai com os
 * mesmos blocos: um grupo por fornecedor, na ordem em que aparecem na listagem. Na
 * visão em lista, tudo vai em um grupo único e sem título.
 */
export function resultadoDeCertidoes(certidoes, { titulo = TITULO_PADRAO, agrupado = false } = {}) {
  const lista = certidoes ?? [];

  const grupos = agrupado
    ? montarGruposPorFornecedor(lista)
    : [{ nome: null, linhas: linhasDeCertidoes(lista), totais: {} }];

  return {
    nome: titulo,
    colunas: COLUNAS_CERTIDOES,
    grupos,
    registros: lista.length,
    totais: {},
    campoTotal: null,
  };
}

function montarGruposPorFornecedor(lista) {
  const porFornecedor = new Map();

  lista.forEach((certidao) => {
    const chave = String(certidao.fornecedor_id ?? certidao.id);
    if (!porFornecedor.has(chave)) {
      const secretaria = nomeSecretaria(certidao.fornecedores);
      const nome = nomeFornecedor(certidao.fornecedores);
      porFornecedor.set(chave, {
        nome: secretaria ? `${nome} · ${secretaria}` : nome,
        certidoes: [],
      });
    }
    porFornecedor.get(chave).certidoes.push(certidao);
  });

  return [...porFornecedor.values()].map((grupo) => ({
    nome: grupo.nome,
    linhas: linhasDeCertidoes(grupo.certidoes),
    totais: {},
  }));
}

/**
 * Título do documento a partir do recorte que está valendo na tela. O atalho de
 * prazo é o que mais muda a leitura do relatório, então ele manda no título:
 * "Certidões vencendo nos próximos 30 dias".
 */
export function tituloDoRecorte(filtros) {
  const atalho = String(filtros?.atalho ?? "").trim();
  if (atalho === "vencidas") return "Certidões vencidas";
  if (atalho === "sem_documento") return "Fornecedores sem certidão cadastrada";

  const dias = ATALHOS.find((a) => a.id === atalho)?.dias;
  if (dias) return `Certidões vencendo nos próximos ${dias} dias`;

  return TITULO_PADRAO;
}

/** Período do documento: o intervalo de vencimento pedido nos filtros, se houver. */
export function periodoDosFiltros(filtros) {
  const vencimento = textoPeriodo(filtros?.vencimentoInicial, filtros?.vencimentoFinal);
  if (vencimento) return `Vencimento: ${vencimento}`;

  const emissao = textoPeriodo(filtros?.emissaoInicial, filtros?.emissaoFinal);
  if (emissao) return `Emissão: ${emissao}`;

  return "Todas as certidões cadastradas";
}

/**
 * Resumo dos filtros usados: "Fornecedor: XYZ | Situação: Vencida". O período fica
 * fora daqui porque tem linha própria no cabeçalho.
 */
export function resumoDosFiltros(filtros, { secretarias = [], tipos = [] } = {}) {
  const f = filtros ?? {};

  const secretaria = f.secretariaId
    ? secretarias.find((s) => String(s.id) === String(f.secretariaId))?.nome ?? "Secretaria selecionada"
    : "";
  const tipo = f.tipoId
    ? tipos.find((t) => String(t.id) === String(f.tipoId))?.nome ?? "Tipo selecionado"
    : "";
  const atalho = f.atalho ? ATALHOS.find((a) => a.id === f.atalho)?.label ?? "" : "";
  const emissao = textoPeriodo(f.emissaoInicial, f.emissaoFinal);

  const texto = resumoDeFiltros([
    { label: "Fornecedor", valor: String(f.fornecedor ?? "").trim() },
    { label: "CPF/CNPJ", valor: String(f.cnpj ?? "").trim() },
    { label: "Secretaria", valor: secretaria },
    { label: "Tipo", valor: tipo },
    { label: "Situação", valor: f.situacao ? situacaoInfo(f.situacao).label : "" },
    // A emissão só entra aqui quando o período do cabeçalho já é o de vencimento.
    { label: "Emissão", valor: textoPeriodo(f.vencimentoInicial, f.vencimentoFinal) ? emissao : "" },
    { label: "Recorte", valor: atalho },
  ]);

  return texto || "Nenhum filtro aplicado";
}

/** Cabeçalho padronizado: instituição, recorte, filtros, emissão e emissor. */
export function cabecalhoDasCertidoes({ titulo, filtros, secretarias, tipos, usuario, geradoEm } = {}) {
  return montarCabecalho({
    relatorio: titulo ?? tituloDoRecorte(filtros),
    periodo: periodoDosFiltros(filtros),
    filtros: resumoDosFiltros(filtros, { secretarias, tipos }),
    geradoEm: geradoEm ?? agoraBR(),
    usuario,
  });
}

function documento({ certidoes, filtros, secretarias, tipos, usuario, geradoEm, agrupado }) {
  const titulo = tituloDoRecorte(filtros);
  const resultado = resultadoDeCertidoes(certidoes, { titulo, agrupado });
  return {
    titulo,
    resultado,
    cabecalho: cabecalhoDasCertidoes({ titulo, filtros, secretarias, tipos, usuario, geradoEm }),
    maxPaginas: maxPaginas(resultado.registros),
  };
}

export function imprimirCertidoes(dados) {
  const { titulo, resultado, cabecalho, maxPaginas: paginas } = documento(dados);
  if (resultado.registros === 0) return false;
  imprimirRelatorio({ titulo, resultado, cabecalho, maxPaginas: paginas });
  return true;
}

export function gerarPdfCertidoes(dados) {
  const { titulo, resultado, cabecalho, maxPaginas: paginas } = documento(dados);
  if (resultado.registros === 0) return false;
  gerarPdfRelatorio({
    titulo,
    resultado,
    cabecalho,
    maxPaginas: paginas,
    arquivo: `${nomeDoArquivo()}.pdf`,
  });
  return true;
}

export function exportarExcelCertidoes(dados) {
  const { titulo, resultado } = documento(dados);
  if (resultado.registros === 0) return false;
  exportarExcelRelatorio({ titulo, resultado, arquivo: `${nomeDoArquivo()}.xlsx` });
  return true;
}
