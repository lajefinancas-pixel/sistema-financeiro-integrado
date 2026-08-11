import { exportarExcelRelatorio, gerarPdfRelatorio, imprimirRelatorio } from "./relatoriosDocumento";
import { montarCabecalho, resumoDeFiltros, textoPeriodo } from "./relatoriosCabecalho";
import { agoraBR } from "./saldosDocumento";
import { formatarDataHora, moduloLabel, tipoInfo } from "./historicoMovimentacoes";

// Impressão, PDF e planilha da linha do tempo do Histórico.
//
// Nada de formatação nova: as movimentações são convertidas no mesmo "resultado" que
// a Central de Relatórios monta (colunas declaradas + linhas prontas), e a geração dos
// três documentos é a das telas de Saldos, Relatórios e Auditoria — inclusive o padrão
// de compactação, que diminui a densidade até o documento caber no número de páginas
// pedido, e a orientação automática pela quantidade de colunas (aqui, paisagem).
//
// O topo do documento identifica o recorte que estava valendo na tela: período
// consultado, filtros usados, data/hora da emissão e quem emitiu.

export const TITULO_DOCUMENTO = "Histórico de Movimentações";

/**
 * Colunas do documento, na ordem em que a linha do tempo apresenta cada item.
 * Todas são de texto: os rótulos (tipo, módulo) já saem daqui prontos para
 * leitura, do jeito que aparecem na tela.
 */
export const COLUNAS_HISTORICO = [
  { chave: "data_hora", label: "Data/Hora", peso: 13 },
  { chave: "tipo", label: "Tipo", peso: 14 },
  { chave: "modulo", label: "Módulo", peso: 11 },
  { chave: "usuario", label: "Usuário", peso: 17 },
  { chave: "registro", label: "Registro afetado", peso: 24 },
  { chave: "secretaria", label: "Secretaria", peso: 13 },
  { chave: "alteracoes", label: "Alterações", peso: 26 },
];

/**
 * Quantas linhas caberiam numa folha sem apertar a fonte. O limite de páginas do
 * documento sai daí: um recorte curto é impresso espaçado e um longo continua
 * compactado, em vez de esmagar centenas de movimentações em três folhas.
 */
const LINHAS_POR_PAGINA = 34;

function maxPaginas(quantidade) {
  return Math.max(2, Math.ceil(quantidade / LINHAS_POR_PAGINA));
}

/** Data de hoje (fuso local) para o nome do arquivo. */
function hojeISO() {
  const agora = new Date();
  const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function nomeDoArquivo() {
  return `historico-${hojeISO()}`;
}

/**
 * O que mudou numa movimentação, em uma linha de texto: "Telefone: (11) 1111 →
 * (11) 2222 | E-mail: -- (novo)". Só entram os campos que realmente mudaram, os
 * mesmos que a tela mostra ao expandir o item.
 */
export function textoDasMudancas(movimentacao) {
  const mudancas = movimentacao?.mudancas ?? [];
  if (mudancas.length === 0) return String(movimentacao?.detalhe ?? "");
  return mudancas
    .map((m) => {
      if (!m.tinhaAntes) return `${m.label}: ${m.depois} (novo)`;
      if (!m.temDepois) return `${m.label}: ${m.antes} (removido)`;
      return `${m.label}: ${m.antes} → ${m.depois}`;
    })
    .join(" | ");
}

/** Uma linha de documento por movimentação da linha do tempo. */
export function linhasDeMovimentacoes(movimentacoes) {
  return (movimentacoes ?? []).map((m) => ({
    data_hora: formatarDataHora(m.instante),
    tipo: tipoInfo(m.tipo).label,
    modulo: moduloLabel(m.modulo),
    usuario: m.usuario || "",
    registro: m.registro || "",
    secretaria: m.secretaria || "",
    alteracoes: textoDasMudancas(m),
  }));
}

/**
 * As movimentações no formato que a impressão, o PDF e a planilha esperam: um
 * único grupo sem título (a linha do tempo é cronológica, não agrupada) e
 * nenhuma coluna somável.
 */
export function resultadoDeMovimentacoes(movimentacoes) {
  const linhas = linhasDeMovimentacoes(movimentacoes);
  return {
    nome: TITULO_DOCUMENTO,
    colunas: COLUNAS_HISTORICO,
    grupos: [{ nome: null, linhas, totais: {} }],
    registros: linhas.length,
    totais: {},
    campoTotal: null,
  };
}

/** Período consultado, como ele aparece no cabeçalho do documento. */
export function periodoDosFiltros(filtros) {
  return textoPeriodo(filtros?.dataInicial, filtros?.dataFinal) || "Todo o período registrado";
}

/**
 * Resumo dos filtros usados na consulta: "Usuário: Ana | Módulo: Saldos".
 * O período fica fora daqui porque tem linha própria no cabeçalho.
 */
export function resumoDosFiltros(filtros, usuarios = []) {
  const f = filtros ?? {};
  const nomeDoUsuario = f.usuarioId
    ? usuarios.find((u) => String(u.id) === String(f.usuarioId))?.nome_completo ?? "Usuário selecionado"
    : "";

  const texto = resumoDeFiltros([
    { label: "Usuário", valor: nomeDoUsuario },
    { label: "Secretaria", valor: String(f.secretaria ?? "").trim() },
    { label: "Módulo", valor: f.modulo ? moduloLabel(f.modulo) : "" },
    { label: "Tipo", valor: f.tipo ? tipoInfo(f.tipo).label : "" },
  ]);

  return texto || "Nenhum filtro aplicado";
}

/**
 * Cabeçalho do documento: instituição, nome do relatório, período consultado,
 * filtros usados, data/hora da emissão e o responsável pela emissão.
 */
export function cabecalhoDoHistorico({ filtros, usuarios, usuario, geradoEm } = {}) {
  return montarCabecalho({
    relatorio: TITULO_DOCUMENTO,
    periodo: periodoDosFiltros(filtros),
    filtros: resumoDosFiltros(filtros, usuarios),
    geradoEm: geradoEm ?? agoraBR(),
    usuario,
  });
}

function documento({ movimentacoes, filtros, usuarios, usuario, geradoEm }) {
  const resultado = resultadoDeMovimentacoes(movimentacoes);
  return {
    resultado,
    cabecalho: cabecalhoDoHistorico({ filtros, usuarios, usuario, geradoEm }),
    maxPaginas: maxPaginas(resultado.registros),
  };
}

export function imprimirHistorico(dados) {
  const { resultado, cabecalho, maxPaginas: paginas } = documento(dados);
  if (resultado.registros === 0) return false;
  imprimirRelatorio({ titulo: TITULO_DOCUMENTO, resultado, cabecalho, maxPaginas: paginas });
  return true;
}

export function gerarPdfHistorico(dados) {
  const { resultado, cabecalho, maxPaginas: paginas } = documento(dados);
  if (resultado.registros === 0) return false;
  gerarPdfRelatorio({
    titulo: TITULO_DOCUMENTO,
    resultado,
    cabecalho,
    maxPaginas: paginas,
    arquivo: `${nomeDoArquivo()}.pdf`,
  });
  return true;
}

export function exportarExcelHistorico(dados) {
  const { resultado } = documento(dados);
  if (resultado.registros === 0) return false;
  exportarExcelRelatorio({
    titulo: TITULO_DOCUMENTO,
    resultado,
    arquivo: `${nomeDoArquivo()}.xlsx`,
  });
  return true;
}
