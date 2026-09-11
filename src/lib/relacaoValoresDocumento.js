import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { agoraBR } from "./saldosDocumento";
import { imprimirDocumentoHtml } from "./impressaoNavegador";
import { formatBRL, formatBRLSimples, marcarCelulasDeMoeda } from "./moeda";

// Impressão, PDF e planilha da RELAÇÃO DE VALORES.
//
// É o documento mais enxuto do sistema: cabeçalho curto (nome da relação e data
// de emissão), uma tabela de DUAS colunas -- nome à esquerda, valor à direita --
// e o TOTAL destacado no fim. Nada mais vai para o papel: nem CNPJ, secretaria,
// situação, certidão, dados bancários, PIX, NF, processo, evento, data,
// observação, ícone ou botão.
//
// Layout próprio, nunca captura de tela: o HTML sai em uma janela escondida com
// o @page A4 retrato, margens reduzidas e numeração de páginas, do mesmo jeito
// que os relatórios completos. O PDF repete esse desenho coluna por coluna, e a
// planilha leva as mesmas duas colunas com o valor como número -- os três saem
// da mesma relação já ordenada e somada por `relacaoDeValores.js`, então não têm
// como divergir entre si nem da tela.
//
// Retrato sempre: com duas colunas não existe motivo para deitar a folha.

const COR_NAVY = [15, 42, 68];
const COR_CINZA = [90, 107, 124];

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// O separador do "R$" vem como espaço não separável, que algumas fontes de PDF não possuem.
function textoSimples(v) {
  return String(v ?? "").replace(/[  ]/g, " ").replace(/−/g, "-");
}

function relacaoValida(relacao) {
  return Boolean(relacao) && (relacao.itens ?? []).length > 0;
}

/** "Relacao de valores - Patrocinios.pdf" quando a tela não sugere um nome. */
function nomeDoArquivo(arquivo, relacao, extensao) {
  if (arquivo) return arquivo;
  const base = textoSimples(relacao?.titulo ?? "relacao-de-valores")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  return `${base || "relacao-de-valores"}.${extensao}`;
}

/* -------------------------------------------------------------------------
 * Impressão (HTML)
 * ---------------------------------------------------------------------- */

/**
 * Documento HTML da relação: duas colunas, linhas compactas e o total no pé.
 *
 * A fonte fica em 11px com linhas justas -- é o ponto em que cabe o máximo de
 * registros por página sem prejudicar a leitura de quem recebe o papel. O
 * cabeçalho da tabela se repete a cada página (`thead` como grupo de cabeçalho),
 * então nenhuma folha aparece sem saber o que é cada coluna.
 */
export function montarHtmlRelacaoDeValores({ relacao, geradoEm } = {}) {
  const emitidoEm = String(geradoEm ?? "").trim() || agoraBR();

  const corpo = (relacao?.itens ?? [])
    .map(
      (item) =>
        `<tr><td class="nome">${esc(item.nome)}</td><td class="valor">${esc(formatBRL(item.valor))}</td></tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${esc(relacao?.titulo)}</title>
<style>
  /* Duas colunas cabem folgadas em retrato; as margens são estreitas para
     aproveitar a folha, mantendo a área de grampo. */
  @page {
    size: A4 portrait;
    margin: 10mm 12mm;
    @bottom-right { content: "Página " counter(page) " de " counter(pages); font-size: 8pt; color: #5A6B7C; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: #0F2A44; font-size: 11px; line-height: 1.3;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  header { border-bottom: 1.5px solid #0F2A44; padding-bottom: 4px; margin-bottom: 8px; }
  header h1 { margin: 0; font-size: 15px; font-weight: 700; }
  header .emissao { margin-top: 2px; color: #5A6B7C; font-size: 9.5px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  tfoot { display: table-row-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th {
    text-align: left; font-weight: 600; font-size: 9.5px; text-transform: uppercase;
    color: #5A6B7C; border-bottom: 1px solid #C9CFD6; padding: 3px 6px; white-space: nowrap;
  }
  th.valor, td.valor { text-align: right; }
  td {
    padding: 2.2px 6px; border-bottom: 1px solid #E7EAEE;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  td.valor { font-weight: 700; font-variant-numeric: tabular-nums; }
  tfoot td {
    border-top: 1.5px solid #0F2A44; border-bottom: 0; font-weight: 700;
    font-size: 13px; padding-top: 5px; text-transform: uppercase;
  }
</style>
</head>
<body>
  <header>
    <h1>${esc(relacao?.titulo)}</h1>
    <div class="emissao">Emitido em ${esc(emitidoEm)}</div>
  </header>
  <table>
    <colgroup><col style="width:70%"><col style="width:30%"></colgroup>
    <thead>
      <tr><th>${esc(relacao?.rotuloNome)}</th><th class="valor">${esc(relacao?.rotuloValor)}</th></tr>
    </thead>
    <tbody>${corpo}</tbody>
    <tfoot>
      <tr><td>Total</td><td class="valor">${esc(formatBRL(relacao?.total))}</td></tr>
    </tfoot>
  </table>
</body>
</html>`;
}

/** Imprime a relação em documento próprio, com o layout acima. */
export function imprimirRelacaoDeValores({ relacao, geradoEm } = {}) {
  if (!relacaoValida(relacao)) return;
  imprimirDocumentoHtml(montarHtmlRelacaoDeValores({ relacao, geradoEm }));
}

/* -------------------------------------------------------------------------
 * PDF
 * ---------------------------------------------------------------------- */

/**
 * O conteúdo da tabela do PDF: cabeçalho, corpo e a linha de TOTAL.
 *
 * Fica separado do desenho de propósito -- é o que garante, e permite conferir,
 * que o PDF leva as MESMAS duas colunas, as mesmas linhas e o mesmo total da
 * impressão, e não uma segunda versão da tabela.
 */
export function conteudoDoPdfDaRelacao(relacao) {
  return {
    head: [[textoSimples(relacao?.rotuloNome), textoSimples(relacao?.rotuloValor)]],
    body: (relacao?.itens ?? []).map((item) => [
      textoSimples(item.nome),
      textoSimples(formatBRLSimples(item.valor)),
    ]),
    foot: [["TOTAL", textoSimples(formatBRLSimples(relacao?.total))]],
  };
}

/**
 * PDF com o mesmo formato da impressão: título curto, duas colunas, total no pé
 * e numeração de páginas.
 */
export function gerarPdfRelacaoDeValores({ relacao, arquivo, geradoEm } = {}) {
  if (!relacaoValida(relacao)) return;

  const emitidoEm = String(geradoEm ?? "").trim() || agoraBR();
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const larguraPagina = doc.internal.pageSize.getWidth();
  const alturaPagina = doc.internal.pageSize.getHeight();
  const margem = 34;
  const larguraUtil = larguraPagina - margem * 2;
  const fonte = 9.5;
  const alturaCabecalho = 30;

  /** Cabeçalho curto, repetido no topo de cada página. */
  const desenharCabecalho = () => {
    let y = margem + 12;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...COR_NAVY);
    doc.text(textoSimples(relacao.titulo), margem, y);

    y += 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fonte - 1);
    doc.setTextColor(...COR_CINZA);
    doc.text(textoSimples(`Emitido em ${emitidoEm}`), margem, y);

    doc.setDrawColor(...COR_NAVY);
    doc.setLineWidth(0.8);
    doc.line(margem, margem + alturaCabecalho, larguraPagina - margem, margem + alturaCabecalho);
    doc.setTextColor(...COR_NAVY);
  };

  const topo = margem + alturaCabecalho + 10;

  autoTable(doc, {
    startY: topo,
    margin: { top: topo, left: margem, right: margem, bottom: margem + 12 },
    theme: "grid",
    styles: {
      fontSize: fonte,
      cellPadding: 2.6,
      lineColor: [225, 229, 234],
      lineWidth: 0.4,
      textColor: COR_NAVY,
      overflow: "ellipsize",
    },
    headStyles: { fillColor: [238, 241, 245], textColor: COR_NAVY, fontStyle: "bold" },
    footStyles: { fillColor: [255, 255, 255], textColor: COR_NAVY, fontStyle: "bold", fontSize: fonte + 2 },
    columnStyles: {
      0: { cellWidth: larguraUtil * 0.7, halign: "left" },
      1: { cellWidth: larguraUtil * 0.3, halign: "right", fontStyle: "bold" },
    },
    showHead: "everyPage",
    rowPageBreak: "avoid",
    pageBreak: "auto",
    ...conteudoDoPdfDaRelacao(relacao),
    didDrawPage: desenharCabecalho,
  });

  // A numeração sai depois de o documento estar fechado, para o "de N" ser exato.
  const paginas = doc.getNumberOfPages();
  const linhaRodape = alturaPagina - margem + fonte;
  for (let pagina = 1; pagina <= paginas; pagina++) {
    doc.setPage(pagina);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fonte - 1);
    doc.setTextColor(...COR_CINZA);
    doc.text(`Página ${pagina} de ${paginas}`, larguraPagina - margem, linhaRodape, { align: "right" });
  }

  doc.save(nomeDoArquivo(arquivo, relacao, "pdf"));
}

/* -------------------------------------------------------------------------
 * Planilha
 * ---------------------------------------------------------------------- */

/**
 * Excel com as MESMAS duas colunas do papel e a linha de TOTAL no fim.
 *
 * O valor sai como número com o formato de moeda brasileiro gravado na célula
 * (R$ #,##0.00) -- como em todas as exportações do sistema, para a coluna somar
 * na planilha de quem recebe o arquivo.
 */
export function exportarExcelRelacaoDeValores({ relacao, arquivo } = {}) {
  if (!relacaoValida(relacao)) return;

  const cabecalho = [relacao.rotuloNome, relacao.rotuloValor];
  const linhas = relacao.itens.map((item) => [item.nome, item.valor]);
  const linhaTotal = ["TOTAL", relacao.total];

  const planilha = XLSX.utils.aoa_to_sheet([cabecalho, ...linhas, linhaTotal]);
  marcarCelulasDeMoeda(
    planilha,
    [...linhas.map((_, indice) => ({ linha: indice + 1, coluna: 1 })), { linha: linhas.length + 1, coluna: 1 }]
  );
  planilha["!cols"] = [{ wch: 48 }, { wch: 18 }];

  const arquivoExcel = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(arquivoExcel, planilha, "Relacao");
  XLSX.writeFile(arquivoExcel, nomeDoArquivo(arquivo, relacao, "xlsx"));
}
