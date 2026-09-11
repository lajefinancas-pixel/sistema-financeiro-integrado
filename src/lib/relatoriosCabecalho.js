// Cabeçalho padronizado dos relatórios impressos e em PDF.
//
// Todo documento da Central de Relatórios -- pronto, personalizado ou comparativo
// -- sai com o mesmo topo: instituição, nome do relatório, período, filtros, data
// e hora da geração, quem emitiu e a numeração de páginas. Este arquivo monta esse
// bloco (só texto, nada de banco) para que impressão, PDF e a tela mostrem
// exatamente a mesma identificação.

import { formatarDataBR } from "./relatoriosCatalogo";
import { agoraBR } from "./saldosDocumento";

/**
 * Nome da instituição como ele aparece no cabeçalho do sistema hoje (o topo da
 * barra lateral: "Secretaria de Finanças / Gestão que transforma").
 */
export const INSTITUICAO = {
  nome: "Secretaria de Finanças",
  lema: "Gestão que transforma",
};

/** "01/01/2026 a 11/08/2026" -- vazio quando o relatório não tem período. */
export function textoPeriodo(inicio, fim) {
  const de = String(inicio ?? "").trim();
  const ate = String(fim ?? "").trim();
  if (de === "" && ate === "") return "";
  if (de !== "" && ate !== "") return `${formatarDataBR(de)} a ${formatarDataBR(ate)}`;
  return de !== "" ? `A partir de ${formatarDataBR(de)}` : `Até ${formatarDataBR(ate)}`;
}

/**
 * Resumo textual dos filtros: "Secretaria: Saúde | Status: Ativo".
 * Aceita pares { label, valor } e também textos já prontos.
 */
export function resumoDeFiltros(partes) {
  return (partes ?? [])
    .map((parte) => {
      if (parte === null || parte === undefined) return "";
      if (typeof parte === "string") return parte.trim();
      const valor = String(parte.valor ?? "").trim();
      if (valor === "") return "";
      return parte.label ? `${parte.label}: ${valor}` : valor;
    })
    .filter((texto) => texto !== "")
    .join(" | ");
}

/** Quem emitiu: "João Silva — Contador" (o cargo entra só quando existe). */
export function textoEmissor(usuario) {
  const nome = String(usuario?.nome_completo ?? usuario?.nome ?? "").trim();
  if (nome === "") return "";
  const cargo = String(usuario?.cargo ?? "").trim();
  return cargo === "" ? nome : `${nome} — ${cargo}`;
}

/**
 * Cabeçalho completo de um documento. `filtros` pode vir como texto pronto ou
 * como a lista de pares aceita por `resumoDeFiltros`.
 */
export function montarCabecalho({ relatorio, periodo, filtros, geradoEm, usuario } = {}) {
  return {
    instituicao: INSTITUICAO.nome,
    lema: INSTITUICAO.lema,
    relatorio: String(relatorio ?? "Relatório").trim(),
    periodo: String(periodo ?? "").trim(),
    filtros: Array.isArray(filtros) ? resumoDeFiltros(filtros) : String(filtros ?? "").trim(),
    geradoEm: String(geradoEm ?? "").trim() || agoraBR(),
    usuario: typeof usuario === "string" ? usuario.trim() : textoEmissor(usuario),
  };
}

/** Uma linha só com a identificação, usada quando o documento é bem estreito. */
export function linhaDeEmissao(cabecalho) {
  const partes = [`Gerado em ${cabecalho?.geradoEm ?? agoraBR()}`];
  if (cabecalho?.usuario) partes.push(`Emitido por ${cabecalho.usuario}`);
  return partes.join(" · ");
}

/* -------------------------------------------------------------------------
 * Impressão: densidade e orientação
 * ---------------------------------------------------------------------- */

/**
 * Os três modos de impressão oferecidos em todos os relatórios, na ordem em que
 * a tela os mostra -- do mais completo ao mais enxuto.
 *
 * "detalhada" prioriza a leitura: fonte maior e texto completo, sem cortar o
 * conteúdo das células, usando quantas páginas precisar. "compacta" segue o
 * mesmo aproveitamento de folha da tela de Saldos -- a densidade diminui até o
 * relatório caber em poucas páginas, sem espaços em branco sobrando. As duas
 * levam ao papel TODAS as colunas do relatório e continuam exatamente como
 * eram: só o rótulo mostrado na tela mudou.
 *
 * "valores" é a relação de duas colunas (nome e valor, mais o TOTAL): a forma
 * mais enxuta de levar a área ao gestor. `duasColunas` é o que avisa os
 * documentos de que esse modo tem layout próprio, e por isso ele não declara
 * densidade -- não há colunas a apertar nem texto a cortar.
 */
export const MODOS_IMPRESSAO = [
  {
    id: "detalhada",
    rotulo: "Relatório detalhado",
    descricao: "Fonte maior e texto completo, sem cortes -- usa quantas páginas precisar.",
    maxPaginas: 14,
    quebrarTexto: true,
  },
  {
    id: "compacta",
    rotulo: "Relação compacta",
    descricao: "Aproveita o máximo da folha: fonte menor e linhas justas, em poucas páginas.",
    maxPaginas: 3,
    quebrarTexto: false,
  },
  {
    id: "valores",
    rotulo: "Relação de valores",
    descricao: "Só nome e valor, com o total no fim -- o formato mais enxuto para levar ao gestor.",
    maxPaginas: 14,
    quebrarTexto: false,
    duasColunas: true,
  },
];

/**
 * O padrão continua sendo a impressão compacta, escrito por extenso de
 * propósito: vários documentos do sistema (auditoria, baixas, certidões,
 * histórico) chamam a impressão sem dizer o modo e contam com essa densidade.
 * Amarrar o padrão à posição na lista faria a ordem mostrada na tela mudar o
 * formato desses documentos.
 */
export const MODO_IMPRESSAO_PADRAO = "compacta";

/** O modo pedido; qualquer valor desconhecido cai no padrão (compacta). */
export function modoImpressao(id) {
  return (
    MODOS_IMPRESSAO.find((m) => m.id === id) ??
    MODOS_IMPRESSAO.find((m) => m.id === MODO_IMPRESSAO_PADRAO)
  );
}

// Acima disso a tabela não cabe em retrato sem apertar as colunas.
const COLUNAS_PARA_PAISAGEM = 6;
const PESO_PARA_PAISAGEM = 120;

/**
 * Orientação escolhida automaticamente pela quantidade (e pela largura pedida)
 * das colunas do relatório: muitas colunas saem em paisagem, o resto em retrato.
 */
export function orientacaoSugerida(colunas) {
  const lista = Array.isArray(colunas) ? colunas : [];
  if (lista.length === 0) return "portrait";
  const peso = lista.reduce((acc, c) => acc + (c?.peso ?? 10), 0);
  return lista.length > COLUNAS_PARA_PAISAGEM || peso > PESO_PARA_PAISAGEM ? "landscape" : "portrait";
}

/** "A4 paisagem · 8 colunas" -- explica na tela o que a impressão vai fazer. */
export function textoOrientacao(colunas) {
  const total = Array.isArray(colunas) ? colunas.length : 0;
  const orientacao = orientacaoSugerida(colunas) === "landscape" ? "paisagem" : "retrato";
  return `A4 ${orientacao} · ${total} ${total === 1 ? "coluna" : "colunas"}`;
}
