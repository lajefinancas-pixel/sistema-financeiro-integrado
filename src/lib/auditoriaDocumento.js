import { exportarExcelRelatorio, gerarPdfRelatorio, imprimirRelatorio } from "./relatoriosDocumento";
import { montarCabecalho, resumoDeFiltros, textoPeriodo } from "./relatoriosCabecalho";
import { agoraBR } from "./saldosDocumento";
import {
  acaoLabel,
  formatarDataHora,
  HORAS_ALERTA_CRITICO,
  moduloLabel,
  nivelInfo,
  nomeDoAutor,
  resultadoLabel,
} from "./auditoria";

// Impressão, PDF e planilha da trilha de auditoria.
//
// Nada de novo em formatação: os eventos são convertidos no mesmo "resultado" que a
// Central de Relatórios monta (colunas declaradas + linhas prontas), e a geração dos
// três documentos é a das telas de Saldos e Relatórios — inclusive o padrão de
// compactação, que diminui a densidade até o documento caber no número de páginas
// pedido, e a orientação automática pela quantidade de colunas (aqui, paisagem).
//
// O que muda é apenas a identificação do topo, que a auditoria precisa ter sempre:
// período consultado, filtros usados, data/hora da emissão e quem emitiu.

export const TITULO_DOCUMENTO = "Trilha de Auditoria";

/**
 * Colunas do documento, na mesma ordem da tabela da tela. Todas são de texto: os
 * rótulos (módulo, ação, nível, resultado) já saem daqui prontos para leitura, do
 * jeito que aparecem na lista.
 */
export const COLUNAS_AUDITORIA = [
  { chave: "data_hora", label: "Data/Hora", peso: 13 },
  { chave: "usuario", label: "Usuário", peso: 18 },
  { chave: "modulo", label: "Módulo", peso: 11 },
  { chave: "acao", label: "Ação", peso: 15 },
  { chave: "registro", label: "Registro afetado", peso: 25 },
  { chave: "nivel", label: "Nível", peso: 9 },
  { chave: "resultado", label: "Resultado", peso: 9 },
];

/**
 * Quantas linhas caberiam numa folha sem apertar a fonte. O limite de páginas do
 * documento sai daí: uma trilha curta é impressa espaçada e uma longa continua
 * compactada, em vez de esmagar centenas de eventos em três folhas.
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
  return `auditoria-${hojeISO()}`;
}

/** Uma linha de documento por evento da trilha. */
export function linhasDeEventos(eventos) {
  return (eventos ?? []).map((evento) => ({
    data_hora: formatarDataHora(evento.data_hora),
    usuario: nomeDoAutor(evento),
    modulo: moduloLabel(evento.modulo),
    acao: acaoLabel(evento.acao),
    registro: evento.registro_afetado || "",
    nivel: nivelInfo(evento.nivel).label,
    resultado: resultadoLabel(evento.resultado),
  }));
}

/**
 * Os eventos no formato que a impressão, o PDF e a planilha esperam: um único
 * grupo sem título (a trilha é cronológica, não agrupada) e nenhuma coluna somável.
 */
export function resultadoDeEventos(eventos) {
  const linhas = linhasDeEventos(eventos);
  return {
    nome: TITULO_DOCUMENTO,
    colunas: COLUNAS_AUDITORIA,
    grupos: [{ nome: null, linhas, totais: {} }],
    registros: linhas.length,
    totais: {},
    campoTotal: null,
  };
}

/** Período consultado, como ele aparece no cabeçalho do documento. */
export function periodoDosFiltros(filtros) {
  const intervalo = textoPeriodo(filtros?.dataInicial, filtros?.dataFinal);
  const desde = String(filtros?.desde ?? "").trim();
  if (desde) {
    const janela = `a partir de ${formatarDataHora(desde)}`;
    return intervalo ? `${intervalo} (${janela})` : `Últimas ${HORAS_ALERTA_CRITICO} horas — ${janela}`;
  }
  return intervalo || "Todo o período registrado";
}

/**
 * Resumo dos filtros usados na consulta: "Módulo: Pagamentos | Nível: Crítico".
 * O período fica fora daqui porque tem linha própria no cabeçalho.
 */
export function resumoDosFiltros(filtros, usuarios = []) {
  const f = filtros ?? {};
  const nomeDoUsuario = f.usuarioId
    ? usuarios.find((u) => String(u.id) === String(f.usuarioId))?.nome_completo ?? "Usuário selecionado"
    : "";

  const texto = resumoDeFiltros([
    { label: "Usuário", valor: nomeDoUsuario },
    { label: "Módulo", valor: f.modulo ? moduloLabel(f.modulo) : "" },
    { label: "Ação", valor: f.acao ? acaoLabel(f.acao) : "" },
    { label: "Nível", valor: f.nivel ? nivelInfo(f.nivel).label : "" },
    { label: "Resultado", valor: f.resultado ? resultadoLabel(f.resultado) : "" },
    { label: "Pesquisa", valor: String(f.busca ?? "").trim() },
  ]);

  return texto || "Nenhum filtro aplicado";
}

/**
 * Cabeçalho do documento: instituição, nome do relatório, período consultado,
 * filtros usados, data/hora da emissão e o responsável pela emissão.
 */
export function cabecalhoDaAuditoria({ filtros, usuarios, usuario, geradoEm } = {}) {
  return montarCabecalho({
    relatorio: TITULO_DOCUMENTO,
    periodo: periodoDosFiltros(filtros),
    filtros: resumoDosFiltros(filtros, usuarios),
    geradoEm: geradoEm ?? agoraBR(),
    usuario,
  });
}

function documento({ eventos, filtros, usuarios, usuario, geradoEm }) {
  const resultado = resultadoDeEventos(eventos);
  return {
    resultado,
    cabecalho: cabecalhoDaAuditoria({ filtros, usuarios, usuario, geradoEm }),
    maxPaginas: maxPaginas(resultado.registros),
  };
}

export function imprimirAuditoria(dados) {
  const { resultado, cabecalho, maxPaginas: paginas } = documento(dados);
  if (resultado.registros === 0) return false;
  imprimirRelatorio({ titulo: TITULO_DOCUMENTO, resultado, cabecalho, maxPaginas: paginas });
  return true;
}

export function gerarPdfAuditoria(dados) {
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

export function exportarExcelAuditoria(dados) {
  const { resultado } = documento(dados);
  if (resultado.registros === 0) return false;
  exportarExcelRelatorio({
    titulo: TITULO_DOCUMENTO,
    resultado,
    arquivo: `${nomeDoArquivo()}.xlsx`,
  });
  return true;
}
