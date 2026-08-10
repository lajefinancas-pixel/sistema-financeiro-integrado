import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// Documento compartilhado de impressão e PDF da página de Saldos das Contas.
// A ordem das colunas é fixa e definitiva: Banco | Número da Conta | Saldo | Nome da Conta
export const COLUNAS_SALDOS = ["Banco", "Número da Conta", "Saldo", "Nome da Conta"];

export function formatBRL(v) {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// O separador do "R$" vem como espaço não separável, que algumas fontes de PDF não possuem.
function textoSimples(v) {
  return String(v ?? "").replace(/\u00A0/g, " ");
}

export function agoraBR() {
  return new Date().toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function totalDaSecao(sec) {
  return sec.total ?? sec.contas.reduce((acc, c) => acc + (c.saldo ?? 0), 0);
}

// --- Densidade: reduz margens, espaçamento e altura de linha até caber no limite de páginas. ---
// A menor faixa ainda mantém 8px/6.5pt, que continua legível em impressão A4.
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

function alturaEstimada(secoes, faixa, alturaLinha) {
  let altura = faixa.fonte * 2.4 + 8; // cabeçalho do documento
  for (const sec of secoes) {
    altura += (faixa.fonte + 1) * 1.5 + faixa.pad * 2; // título da secretaria
    altura += alturaLinha * (sec.contas.length + 2); // cabeçalho da tabela + linhas + total
    altura += faixa.gap;
  }
  return altura + faixa.fonte * 2.2; // total geral
}

function escolherFaixaHtml(secoes, maxPaginas) {
  const limite = ALTURA_PAGINA_PX * maxPaginas * 0.93; // folga para as quebras de página
  for (const faixa of FAIXAS_HTML) {
    const alturaLinha = faixa.fonte * 1.32 + faixa.pad * 2 + 1;
    if (alturaEstimada(secoes, faixa, alturaLinha) <= limite) return faixa;
  }
  return FAIXAS_HTML[FAIXAS_HTML.length - 1];
}

function blocoHtml(sec, faixa) {
  const linhas = sec.contas
    .map(
      (c) => `<tr>
        <td>${esc(c.banco || "--")}</td>
        <td>${esc(c.numero_conta || "--")}</td>
        <td class="saldo">${esc(formatBRL(c.saldo))}</td>
        <td>${esc(c.nome_conta || "--")}</td>
      </tr>`
    )
    .join("");

  return `<section class="bloco">
    <div class="bloco-titulo">
      <span>${esc(sec.nome)}</span>
      <span>Total: ${esc(formatBRL(totalDaSecao(sec)))}</span>
    </div>
    <table>
      <colgroup><col class="c-banco"><col class="c-numero"><col class="c-saldo"><col class="c-nome"></colgroup>
      <thead>
        <tr>
          <th>Banco</th><th>Número da Conta</th><th class="saldo">Saldo</th><th>Nome da Conta</th>
        </tr>
      </thead>
      <tbody>${linhas}</tbody>
      <tfoot>
        <tr>
          <td colspan="2">Total da secretaria</td>
          <td class="saldo">${esc(formatBRL(totalDaSecao(sec)))}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  </section>`;
}

function documentoHtml({ titulo, subtitulo, secoes, faixa, mostrarTotalGeral }) {
  const totalGeral = secoes.reduce((acc, s) => acc + totalDaSecao(s), 0);
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
    display: flex; align-items: flex-end; justify-content: space-between;
    border-bottom: 1.5px solid #0F2A44; padding-bottom: 3px; margin-bottom: ${faixa.gap}px;
  }
  .cabecalho h1 { margin: 0; font-size: ${faixa.fonte + 3}px; font-weight: 600; }
  .cabecalho .quando { font-size: ${faixa.fonte}px; color: #44586C; }
  /* Mantém o título da secretaria colado à sua tabela na quebra de página. */
  .bloco { page-break-inside: avoid; break-inside: avoid; margin-bottom: ${faixa.gap}px; }
  .bloco-titulo {
    display: flex; align-items: center; justify-content: space-between;
    background: #EEF1F5; border-left: 3px solid #0F2A44;
    padding: ${faixa.pad}px 5px; font-weight: 700; font-size: ${faixa.fonte + 1}px; text-transform: uppercase;
  }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th {
    text-align: left; font-weight: 600; font-size: ${Math.max(faixa.fonte - 1, 7)}px;
    text-transform: uppercase; color: #5A6B7C; border-bottom: 1px solid #C9CFD6;
    padding: ${faixa.pad}px 5px; white-space: nowrap;
  }
  td {
    padding: ${faixa.pad}px 5px; border-bottom: 1px solid #E7EAEE;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .c-banco { width: 28%; } .c-numero { width: 20%; } .c-saldo { width: 22%; } .c-nome { width: 30%; }
  th.saldo, td.saldo { text-align: right; }
  td.saldo { font-weight: 700; font-variant-numeric: tabular-nums; }
  tfoot td { border-top: 1.2px solid #0F2A44; border-bottom: 0; font-weight: 700; }
  .total-geral {
    margin-top: ${faixa.gap}px; padding-top: 3px; text-align: right;
    border-top: 1.5px solid #0F2A44; font-weight: 700; font-size: ${faixa.fonte + 1}px;
  }
</style>
</head>
<body>
  <div class="cabecalho">
    <h1>${esc(titulo)}</h1>
    <div class="quando">${esc(subtitulo)}</div>
  </div>
  ${secoes.map((sec) => blocoHtml(sec, faixa)).join("")}
  ${mostrarTotalGeral ? `<div class="total-geral">Total geral: ${esc(formatBRL(totalGeral))}</div>` : ""}
</body>
</html>`;
}

/**
 * Monta o documento HTML compacto: secretarias empilhadas, uma abaixo da outra,
 * com a densidade ajustada para caber no número de páginas pedido.
 */
export function montarHtmlSaldos({ titulo, subtitulo, secoes, maxPaginas = 2 }) {
  const faixa = escolherFaixaHtml(secoes, maxPaginas);
  return documentoHtml({
    titulo,
    subtitulo: subtitulo ?? `Emitido em ${agoraBR()}`,
    secoes,
    faixa,
    mostrarTotalGeral: secoes.length > 1,
  });
}

/**
 * Imprime as secretarias empilhadas (uma abaixo da outra) em um documento próprio,
 * sem interferir no CSS de impressão das outras páginas do sistema.
 */
export function imprimirSaldos({ titulo, subtitulo, secoes, maxPaginas = 2 }) {
  const lista = (secoes ?? []).filter((s) => s && s.contas);
  if (lista.length === 0) return;

  const html = montarHtmlSaldos({ titulo, subtitulo, secoes: lista, maxPaginas });

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

function escolherFaixaPdf(secoes, maxPaginas) {
  const limite = ALTURA_PAGINA_PT * maxPaginas * 0.95;
  for (const faixa of FAIXAS_PDF) {
    const alturaLinha = faixa.fonte * 1.15 + faixa.pad * 2 + 1;
    let altura = 0;
    for (const sec of secoes) altura += alturaLinha * (sec.contas.length + 3) + faixa.gap;
    if (altura + 40 <= limite) return faixa;
  }
  return FAIXAS_PDF[FAIXAS_PDF.length - 1];
}

/**
 * Gera o PDF com o mesmo formato compacto da impressão geral: secretarias empilhadas,
 * na ordem escolhida pelo usuário, com o título de cada bloco preso à sua tabela.
 */
export function gerarPdfSaldos({ titulo, subtitulo, secoes, arquivo, maxPaginas = 2 }) {
  const lista = (secoes ?? []).filter((s) => s && s.contas);
  if (lista.length === 0) return;

  const faixa = escolherFaixaPdf(lista, maxPaginas);
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const larguraPagina = doc.internal.pageSize.getWidth();
  const margem = 26;
  const cabecalho = `${titulo} — ${subtitulo ?? `Emitido em ${agoraBR()}`}`;

  const desenharCabecalho = () => {
    doc.setFontSize(faixa.fonte + 2);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 42, 68);
    doc.text(textoSimples(cabecalho), margem, margem + 6);
    doc.setDrawColor(15, 42, 68);
    doc.setLineWidth(0.8);
    doc.line(margem, margem + 10, larguraPagina - margem, margem + 10);
  };

  const larguraUtil = larguraPagina - margem * 2;
  let posicao = margem + 20;

  lista.forEach((sec) => {
    const total = totalDaSecao(sec);
    autoTable(doc, {
      startY: posicao,
      margin: { top: margem + 20, left: margem, right: margem, bottom: margem },
      theme: "grid",
      styles: {
        fontSize: faixa.fonte,
        cellPadding: faixa.pad,
        lineColor: [225, 229, 234],
        lineWidth: 0.4,
        textColor: [15, 42, 68],
        overflow: "ellipsize",
      },
      headStyles: { fillColor: [238, 241, 245], textColor: [15, 42, 68], fontStyle: "bold" },
      footStyles: { fillColor: [255, 255, 255], textColor: [15, 42, 68], fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: larguraUtil * 0.28 },
        1: { cellWidth: larguraUtil * 0.2 },
        2: { cellWidth: larguraUtil * 0.22, halign: "right", fontStyle: "bold" },
        3: { cellWidth: larguraUtil * 0.3 },
      },
      // O título repete no topo de cada página, então nunca fica órfão da tabela.
      showHead: "everyPage",
      rowPageBreak: "avoid",
      head: [
        [
          {
            content: textoSimples(sec.nome).toUpperCase(),
            colSpan: 3,
            styles: { halign: "left", fontStyle: "bold", fontSize: faixa.fonte + 1 },
          },
          {
            content: `Total: ${textoSimples(formatBRL(total))}`,
            styles: { halign: "right", fontStyle: "bold", fontSize: faixa.fonte + 1 },
          },
        ],
        COLUNAS_SALDOS,
      ],
      body: sec.contas.map((c) => [
        textoSimples(c.banco || "--"),
        textoSimples(c.numero_conta || "--"),
        textoSimples(formatBRL(c.saldo)),
        textoSimples(c.nome_conta || "--"),
      ]),
      foot: [
        [
          { content: "Total da secretaria", colSpan: 2 },
          { content: textoSimples(formatBRL(total)), styles: { halign: "right" } },
          "",
        ],
      ],
      didDrawPage: desenharCabecalho,
    });
    posicao = doc.lastAutoTable.finalY + faixa.gap;
  });

  if (lista.length > 1) {
    const totalGeral = lista.reduce((acc, s) => acc + totalDaSecao(s), 0);
    doc.setFontSize(faixa.fonte + 1);
    doc.setFont("helvetica", "bold");
    doc.text(
      `Total geral: ${textoSimples(formatBRL(totalGeral))}`,
      larguraPagina - margem,
      posicao + faixa.fonte,
      { align: "right" }
    );
  }

  doc.save(arquivo || "saldos.pdf");
}
