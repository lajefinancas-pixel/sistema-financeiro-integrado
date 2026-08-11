import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { agoraBR } from "./saldosDocumento";
import { formatarCelula } from "./relatoriosCatalogo";
import { formatBRL, formatBRLSimples } from "./moeda";

// Impressão, PDF e planilha da Central de Relatórios.
//
// Mesmo padrão de compactação da tela de Saldos: o documento escolhe uma faixa de
// densidade (fonte, espaçamento e altura de linha) grande o bastante para caber no
// número de páginas pedido, e a menor faixa ainda fica legível em A4. A diferença é
// que aqui as colunas são as que o relatório declarou, e não uma lista fixa.

const COR_NAVY = [15, 42, 68];

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// O separador do "R$" vem como espaço não separável, que algumas fontes de PDF não possuem.
function textoSimples(v) {
  return String(v ?? "").replace(/[  ]/g, " ").replace(/−/g, "-");
}

function alinhamento(coluna) {
  return coluna.tipo === "moeda" || coluna.tipo === "numero" ? "right" : "left";
}

function celula(linha, coluna) {
  return formatarCelula(linha[coluna.chave], coluna.tipo);
}

/** Largura de cada coluna em porcentagem, a partir dos pesos declarados. */
function larguras(colunas) {
  const soma = colunas.reduce((acc, c) => acc + (c.peso ?? 10), 0) || 1;
  return colunas.map((c) => ((c.peso ?? 10) / soma) * 100);
}

function textoDoSubtotal(coluna, totais) {
  if (!coluna.somavel) return "";
  return formatarCelula(totais?.[coluna.chave], coluna.tipo);
}

function totalDoGrupo(grupo, campoTotal) {
  if (!campoTotal) return null;
  return grupo.totais?.[campoTotal] ?? 0;
}

// --- Densidade da impressão (HTML) ---
const FAIXAS_HTML = [
  { fonte: 11, pad: 3.4, gap: 10 },
  { fonte: 10, pad: 2.8, gap: 8 },
  { fonte: 9.5, pad: 2.2, gap: 6 },
  { fonte: 9, pad: 1.6, gap: 5 },
  { fonte: 8.5, pad: 1.1, gap: 4 },
  { fonte: 8, pad: 0.7, gap: 3 },
];

// Altura útil aproximada de uma página A4 com margens estreitas, em pixels de tela (96dpi).
const ALTURA_PAGINA_PX = 1040;

function escolherFaixaHtml(grupos, maxPaginas) {
  const limite = ALTURA_PAGINA_PX * maxPaginas * 0.93; // folga para as quebras de página
  for (const faixa of FAIXAS_HTML) {
    const alturaLinha = faixa.fonte * 1.32 + faixa.pad * 2 + 1;
    let altura = faixa.fonte * 2.4 + 8; // cabeçalho do documento
    for (const grupo of grupos) {
      if (grupo.nome) altura += (faixa.fonte + 1) * 1.5 + faixa.pad * 2;
      altura += alturaLinha * (grupo.linhas.length + (grupo.nome ? 2 : 1));
      altura += faixa.gap;
    }
    if (altura + faixa.fonte * 2.2 <= limite) return faixa;
  }
  return FAIXAS_HTML[FAIXAS_HTML.length - 1];
}

function tabelaHtml({ grupo, colunas, campoTotal, larguraPorColuna, rotuloGrupo }) {
  const cabecalho = colunas
    .map((c) => `<th class="${alinhamento(c)}">${esc(c.label)}</th>`)
    .join("");

  const corpo = grupo.linhas
    .map(
      (linha) =>
        `<tr>${colunas
          .map((c) => `<td class="${alinhamento(c)}${c.tipo === "moeda" ? " valor" : ""}">${esc(celula(linha, c))}</td>`)
          .join("")}</tr>`
    )
    .join("");

  const total = totalDoGrupo(grupo, campoTotal);
  const tituloGrupo = grupo.nome
    ? `<tr class="linha-titulo">
        <th colspan="${Math.max(colunas.length - 1, 1)}">${esc(
          rotuloGrupo ? `${rotuloGrupo}: ${grupo.nome}` : grupo.nome
        )}</th>
        <th class="right">${
          total === null
            ? `${grupo.linhas.length} ${grupo.linhas.length === 1 ? "registro" : "registros"}`
            : `Total: ${esc(formatBRL(total))}`
        }</th>
      </tr>`
    : "";

  const temSomavel = colunas.some((c) => c.somavel);
  const rodape = temSomavel
    ? `<tfoot><tr>
        ${colunas
          .map((c, indice) => {
            if (indice === 0) {
              return `<td>${grupo.nome ? "Subtotal" : "Total geral"} (${grupo.linhas.length})</td>`;
            }
            return `<td class="${alinhamento(c)}">${esc(textoDoSubtotal(c, grupo.totais))}</td>`;
          })
          .join("")}
      </tr></tfoot>`
    : "";

  return `<section class="bloco">
    <table>
      <colgroup>${larguraPorColuna.map((l) => `<col style="width:${l.toFixed(2)}%">`).join("")}</colgroup>
      <thead>${tituloGrupo}<tr>${cabecalho}</tr></thead>
      <tbody>${corpo}</tbody>
      ${rodape}
    </table>
  </section>`;
}

/** Documento HTML compacto do relatório selecionado. */
export function montarHtmlRelatorio({ titulo, subtitulo, resultado, maxPaginas = 3 }) {
  const grupos = resultado.grupos.filter((g) => g.linhas.length > 0);
  const faixa = escolherFaixaHtml(grupos, maxPaginas);
  const larguraPorColuna = larguras(resultado.colunas);
  const total = resultado.campoTotal ? resultado.totais?.[resultado.campoTotal] ?? 0 : null;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${esc(titulo)}</title>
<style>
  @page { size: A4 portrait; margin: 8mm 9mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: #0F2A44; font-size: ${faixa.fonte}px; line-height: 1.3;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .cabecalho {
    display: flex; align-items: flex-end; justify-content: space-between; gap: 12px;
    border-bottom: 1.5px solid #0F2A44; padding-bottom: 3px; margin-bottom: ${faixa.gap}px;
  }
  .cabecalho h1 { margin: 0; font-size: ${faixa.fonte + 3}px; font-weight: 600; }
  .cabecalho .quando { font-size: ${faixa.fonte}px; color: #44586C; text-align: right; }
  .bloco { margin-bottom: ${faixa.gap}px; break-inside: auto; page-break-inside: auto; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  /* Nome do grupo e cabeçalho das colunas ficam no <thead>: se a tabela continuar
     na página seguinte, os dois se repetem e nada fica órfão. */
  thead { display: table-header-group; break-inside: avoid; page-break-inside: avoid; break-after: avoid; }
  tfoot { display: table-row-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th {
    text-align: left; font-weight: 600; font-size: ${Math.max(faixa.fonte - 1, 7)}px;
    text-transform: uppercase; color: #5A6B7C; border-bottom: 1px solid #C9CFD6;
    padding: ${faixa.pad}px 5px; white-space: nowrap;
  }
  td {
    padding: ${faixa.pad}px 5px; border-bottom: 1px solid #E7EAEE;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .right { text-align: right; }
  td.valor { font-weight: 700; font-variant-numeric: tabular-nums; }
  .linha-titulo th {
    background: #EEF1F5; color: #0F2A44; font-weight: 700; font-size: ${faixa.fonte + 1}px;
    text-transform: uppercase; border-bottom: 0; padding: ${faixa.pad}px 5px;
  }
  .linha-titulo th:first-child { border-left: 3px solid #0F2A44; }
  tfoot td { border-top: 1.2px solid #0F2A44; border-bottom: 0; font-weight: 700; }
  .rodape {
    margin-top: ${faixa.gap}px; padding-top: 3px; display: flex; justify-content: space-between;
    border-top: 1.5px solid #0F2A44; font-weight: 700; font-size: ${faixa.fonte + 1}px;
  }
</style>
</head>
<body>
  <div class="cabecalho">
    <h1>${esc(titulo)}</h1>
    <div class="quando">${esc(subtitulo)}</div>
  </div>
  ${grupos
    .map((grupo) =>
      tabelaHtml({
        grupo,
        colunas: resultado.colunas,
        campoTotal: resultado.campoTotal,
        larguraPorColuna,
        rotuloGrupo: resultado.rotuloGrupo,
      })
    )
    .join("")}
  <div class="rodape">
    <span>${esc(`${resultado.registros} ${resultado.registros === 1 ? "registro" : "registros"}`)}</span>
    ${total === null ? "<span></span>" : `<span>Total geral: ${esc(formatBRL(total))}</span>`}
  </div>
</body>
</html>`;
}

/**
 * Imprime o relatório em um documento próprio, sem interferir no CSS de impressão
 * das outras páginas do sistema.
 */
export function imprimirRelatorio({ titulo, subtitulo, resultado, maxPaginas = 3 }) {
  if (!resultado || resultado.registros === 0) return;

  const html = montarHtmlRelatorio({
    titulo,
    subtitulo: subtitulo ?? `Emitido em ${agoraBR()}`,
    resultado,
    maxPaginas,
  });

  const quadro = document.createElement("iframe");
  quadro.setAttribute("aria-hidden", "true");
  quadro.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(quadro);

  const remover = () => {
    if (quadro.parentNode) quadro.parentNode.removeChild(quadro);
  };

  const doc = quadro.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  const janela = quadro.contentWindow;
  janela.onafterprint = () => setTimeout(remover, 300);
  setTimeout(() => {
    janela.focus();
    janela.print();
  }, 120);
  setTimeout(remover, 60000); // rede de segurança caso o navegador não dispare onafterprint
}

// --- PDF ---
const FAIXAS_PDF = [
  { fonte: 9, pad: 3, gap: 9 },
  { fonte: 8.5, pad: 2.4, gap: 7 },
  { fonte: 8, pad: 1.9, gap: 6 },
  { fonte: 7.5, pad: 1.5, gap: 5 },
  { fonte: 7, pad: 1.1, gap: 4 },
  { fonte: 6.5, pad: 0.8, gap: 3 },
];

const ALTURA_PAGINA_PT = 760; // A4 (842pt) menos as margens do documento

function escolherFaixaPdf(grupos, maxPaginas) {
  const limite = ALTURA_PAGINA_PT * maxPaginas * 0.95;
  for (const faixa of FAIXAS_PDF) {
    const alturaLinha = faixa.fonte * 1.15 + faixa.pad * 2 + 1;
    let altura = 0;
    for (const grupo of grupos) altura += alturaLinha * (grupo.linhas.length + 3) + faixa.gap;
    if (altura + 40 <= limite) return faixa;
  }
  return FAIXAS_PDF[FAIXAS_PDF.length - 1];
}

/** PDF com o mesmo formato compacto da impressão: grupos empilhados, um abaixo do outro. */
export function gerarPdfRelatorio({ titulo, subtitulo, resultado, arquivo, maxPaginas = 3 }) {
  if (!resultado || resultado.registros === 0) return;

  const grupos = resultado.grupos.filter((g) => g.linhas.length > 0);
  const colunas = resultado.colunas;
  const faixa = escolherFaixaPdf(grupos, maxPaginas);
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const larguraPagina = doc.internal.pageSize.getWidth();
  const margem = 26;
  const cabecalho = `${titulo} — ${subtitulo ?? `Emitido em ${agoraBR()}`}`;

  const desenharCabecalho = () => {
    doc.setFontSize(faixa.fonte + 2);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COR_NAVY);
    doc.text(textoSimples(cabecalho), margem, margem + 6);
    doc.setDrawColor(...COR_NAVY);
    doc.setLineWidth(0.8);
    doc.line(margem, margem + 10, larguraPagina - margem, margem + 10);
  };

  const larguraUtil = larguraPagina - margem * 2;
  const percentuais = larguras(colunas);
  const estilosDeColuna = {};
  colunas.forEach((c, indice) => {
    estilosDeColuna[indice] = {
      cellWidth: (larguraUtil * percentuais[indice]) / 100,
      halign: alinhamento(c),
      ...(c.tipo === "moeda" ? { fontStyle: "bold" } : {}),
    };
  });

  const temSomavel = colunas.some((c) => c.somavel);
  let posicao = margem + 20;

  grupos.forEach((grupo) => {
    const total = totalDoGrupo(grupo, resultado.campoTotal);
    const cabecalhos = [];

    if (grupo.nome) {
      cabecalhos.push([
        {
          content: textoSimples(
            resultado.rotuloGrupo ? `${resultado.rotuloGrupo}: ${grupo.nome}` : grupo.nome
          ).toUpperCase(),
          colSpan: Math.max(colunas.length - 1, 1),
          styles: { halign: "left", fontStyle: "bold", fontSize: faixa.fonte + 1 },
        },
        {
          content:
            total === null
              ? `${grupo.linhas.length} ${grupo.linhas.length === 1 ? "registro" : "registros"}`
              : `Total: ${textoSimples(formatBRLSimples(total))}`,
          styles: { halign: "right", fontStyle: "bold", fontSize: faixa.fonte + 1 },
        },
      ]);
    }
    cabecalhos.push(colunas.map((c) => ({ content: c.label, styles: { halign: alinhamento(c) } })));

    autoTable(doc, {
      startY: posicao,
      margin: { top: margem + 20, left: margem, right: margem, bottom: margem },
      theme: "grid",
      styles: {
        fontSize: faixa.fonte,
        cellPadding: faixa.pad,
        lineColor: [225, 229, 234],
        lineWidth: 0.4,
        textColor: COR_NAVY,
        overflow: "ellipsize",
      },
      headStyles: { fillColor: [238, 241, 245], textColor: COR_NAVY, fontStyle: "bold" },
      footStyles: { fillColor: [255, 255, 255], textColor: COR_NAVY, fontStyle: "bold" },
      columnStyles: estilosDeColuna,
      // O cabeçalho repete no topo de cada página, então nunca fica órfão da tabela.
      showHead: "everyPage",
      rowPageBreak: "avoid",
      pageBreak: "auto",
      head: cabecalhos,
      body: grupo.linhas.map((linha) =>
        colunas.map((c) => textoSimples(c.tipo === "moeda" ? formatBRLSimples(linha[c.chave]) : celula(linha, c)))
      ),
      foot: temSomavel
        ? [
            colunas.map((c, indice) => {
              if (indice === 0) {
                return { content: `${grupo.nome ? "Subtotal" : "Total geral"} (${grupo.linhas.length})` };
              }
              const texto = c.somavel
                ? c.tipo === "moeda"
                  ? formatBRLSimples(grupo.totais?.[c.chave])
                  : String(grupo.totais?.[c.chave] ?? 0)
                : "";
              return { content: textoSimples(texto), styles: { halign: alinhamento(c) } };
            }),
          ]
        : undefined,
      didDrawPage: desenharCabecalho,
    });
    posicao = doc.lastAutoTable.finalY + faixa.gap;
  });

  const total = resultado.campoTotal ? resultado.totais?.[resultado.campoTotal] ?? 0 : null;
  const rodape = `${resultado.registros} ${resultado.registros === 1 ? "registro" : "registros"}${
    total === null ? "" : `   •   Total geral: ${formatBRLSimples(total)}`
  }`;
  const alturaPagina = doc.internal.pageSize.getHeight();
  // Só abre uma página nova se o rodapé realmente não couber na atual.
  if (posicao + faixa.fonte + margem > alturaPagina) {
    doc.addPage();
    desenharCabecalho();
    posicao = margem + 20;
  }
  doc.setFontSize(faixa.fonte + 1);
  doc.setFont("helvetica", "bold");
  doc.text(textoSimples(rodape), larguraPagina - margem, posicao + faixa.fonte, { align: "right" });

  doc.save(arquivo || "relatorio.pdf");
}

// --- Planilha ---
/**
 * Excel com uma linha por registro. Valores monetários vão como número (é a
 * planilha que formata), do mesmo jeito que a exportação de Saldos.
 */
export function exportarExcelRelatorio({ titulo, resultado, arquivo }) {
  if (!resultado || resultado.registros === 0) return;

  const temGrupo = resultado.grupos.some((g) => g.nome);
  const rotuloGrupo = resultado.rotuloGrupo ?? "Grupo";
  const cabecalho = [...(temGrupo ? [rotuloGrupo] : []), ...resultado.colunas.map((c) => c.label)];

  const linhas = [];
  resultado.grupos.forEach((grupo) => {
    grupo.linhas.forEach((linha) => {
      const registro = {};
      if (temGrupo) registro[rotuloGrupo] = grupo.nome ?? "";
      resultado.colunas.forEach((c) => {
        const valor = linha[c.chave];
        if (c.tipo === "moeda" || c.tipo === "numero") registro[c.label] = Number(valor ?? 0);
        else if (c.tipo === "data") registro[c.label] = formatarCelula(valor, "data");
        else registro[c.label] = String(valor ?? "");
      });
      linhas.push(registro);
    });
  });

  const planilha = XLSX.utils.json_to_sheet(linhas, { header: cabecalho });
  const arquivoExcel = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(arquivoExcel, planilha, "Relatorio");
  XLSX.writeFile(arquivoExcel, arquivo || `${titulo || "relatorio"}.xlsx`);
}
