import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { agoraBR } from "./saldosDocumento";
import { colunaNumerica, formatarCelula } from "./relatoriosCatalogo";
import { modoImpressao, orientacaoSugerida } from "./relatoriosCabecalho";
import { colunasPorCabecalho, formatBRL, formatBRLSimples, marcarColunasDeMoeda, paraNumeroMoeda } from "./moeda";

// Impressão, PDF e planilha da Central de Relatórios.
//
// Mesmo padrão de compactação da tela de Saldos: o documento escolhe uma faixa de
// densidade (fonte, espaçamento e altura de linha) grande o bastante para caber no
// número de páginas pedido, e a menor faixa ainda fica legível em A4. A diferença é
// que aqui as colunas são as que o relatório declarou, e não uma lista fixa.
//
// Dois formatos, escolhidos por quem emite:
//
//   compacta  -- aproveita o máximo da folha (o padrão): a densidade diminui até o
//                relatório caber em poucas páginas, sem espaço em branco sobrando.
//   detalhada -- fonte maior e texto completo, sem cortar o conteúdo das células;
//                usa quantas páginas precisar.
//
// A orientação é automática: relatórios com muitas colunas saem em paisagem, o
// resto em retrato -- ninguém precisa escolher isso na tela.
//
// Todo documento leva o mesmo cabeçalho padronizado (instituição, nome do
// relatório, período, filtros, data e hora da geração, emissor) e a numeração de
// páginas.

const COR_NAVY = [15, 42, 68];
const COR_CINZA = [90, 107, 124];

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// O separador do "R$" vem como espaço não separável, que algumas fontes de PDF não possuem.
function textoSimples(v) {
  return String(v ?? "").replace(/[  ]/g, " ").replace(/−/g, "-");
}

function alinhamento(coluna) {
  return colunaNumerica(coluna) ? "right" : "left";
}

/** Formato pedido (densidade + orientação) resolvido a partir do que a tela mandou. */
function formatoDoDocumento({ modo, orientacao, colunas, maxPaginas }) {
  const escolhido = modoImpressao(modo);
  return {
    maxPaginas: maxPaginas ?? escolhido.maxPaginas,
    quebrarTexto: escolhido.quebrarTexto,
    orientacao: orientacao ?? orientacaoSugerida(colunas),
  };
}

function textoRegistros(quantidade) {
  return `${quantidade} ${quantidade === 1 ? "registro" : "registros"}`;
}

/**
 * Cabeçalho padronizado a partir do que a tela mandou, com um caminho de
 * compatibilidade: quando só vem `subtitulo` (texto único), ele entra na linha de
 * emissão, e o documento continua saindo com a mesma estrutura.
 */
function cabecalhoDoDocumento({ titulo, subtitulo, cabecalho }) {
  return {
    instituicao: cabecalho?.instituicao ?? "",
    lema: cabecalho?.lema ?? "",
    relatorio: cabecalho?.relatorio ?? titulo ?? "Relatório",
    periodo: cabecalho?.periodo ?? "",
    filtros: cabecalho?.filtros ?? "",
    geradoEm: cabecalho?.geradoEm ?? "",
    usuario: cabecalho?.usuario ?? "",
    // Sem cabeçalho estruturado, o texto antigo é a única identificação que existe.
    avulso: cabecalho ? "" : String(subtitulo ?? `Emitido em ${agoraBR()}`),
  };
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
// Em paisagem a folha é mais larga e mais baixa: cabem menos linhas por página.
const ALTURA_PAGINA_PX_PAISAGEM = 700;

function escolherFaixaHtml(grupos, maxPaginas, orientacao) {
  const alturaFolha = orientacao === "landscape" ? ALTURA_PAGINA_PX_PAISAGEM : ALTURA_PAGINA_PX;
  const limite = alturaFolha * maxPaginas * 0.93; // folga para as quebras de página
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
            ? `${textoRegistros(grupo.linhas.length)}`
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

/** Bloco de identificação que abre todo documento impresso. */
function cabecalhoHtml(dados) {
  const detalhes = [
    dados.periodo ? `<span><b>Período:</b> ${esc(dados.periodo)}</span>` : "",
    dados.filtros ? `<span><b>Filtros:</b> ${esc(dados.filtros)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");

  const emissao = [
    dados.geradoEm ? `<div>Gerado em ${esc(dados.geradoEm)}</div>` : "",
    dados.usuario ? `<div>Emitido por ${esc(dados.usuario)}</div>` : "",
    dados.avulso ? `<div>${esc(dados.avulso)}</div>` : "",
  ]
    .filter(Boolean)
    .join("");

  return `<header class="cabecalho">
    <div class="topo">
      <div class="marca">
        ${dados.instituicao ? `<div class="instituicao">${esc(dados.instituicao)}</div>` : ""}
        ${dados.lema ? `<div class="lema">${esc(dados.lema)}</div>` : ""}
      </div>
      <div class="emissao">${emissao}</div>
    </div>
    <h1>${esc(dados.relatorio)}</h1>
    ${detalhes ? `<div class="detalhes">${detalhes}</div>` : ""}
  </header>`;
}

/**
 * Documento HTML do relatório selecionado.
 *
 * `cabecalho` é o bloco padronizado (montarCabecalho); `modo` escolhe entre a
 * impressão compacta e a detalhada; `orientacao` normalmente não é informada --
 * ela sai da quantidade de colunas do relatório.
 */
export function montarHtmlRelatorio({ titulo, subtitulo, resultado, cabecalho, modo, orientacao, maxPaginas }) {
  const formato = formatoDoDocumento({ modo, orientacao, colunas: resultado.colunas, maxPaginas });
  const grupos = resultado.grupos.filter((g) => g.linhas.length > 0);
  const faixa = escolherFaixaHtml(grupos, formato.maxPaginas, formato.orientacao);
  const larguraPorColuna = larguras(resultado.colunas);
  const total = resultado.campoTotal ? resultado.totais?.[resultado.campoTotal] ?? 0 : null;
  const identificacao = cabecalhoDoDocumento({ titulo, subtitulo, cabecalho });
  const celulaTexto = formato.quebrarTexto
    ? "white-space: normal; word-break: break-word;"
    : "white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${esc(identificacao.relatorio)}</title>
<style>
  /* A orientação acompanha a largura do relatório: muitas colunas pedem paisagem. */
  @page {
    size: A4 ${formato.orientacao};
    margin: 8mm 9mm;
    /* Numeração de páginas para os motores de impressão que suportam caixa de
       margem; nos demais (Chrome, por exemplo) a própria janela de impressão
       oferece o cabeçalho/rodapé com o número da página. O PDF gerado pelo
       botão "PDF" numera sempre, em qualquer navegador. */
    @bottom-right { content: "Página " counter(page) " de " counter(pages); font-size: 8pt; color: #5A6B7C; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: #0F2A44; font-size: ${faixa.fonte}px; line-height: 1.3;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .cabecalho {
    border-bottom: 1.5px solid #0F2A44; padding-bottom: 3px; margin-bottom: ${faixa.gap}px;
  }
  .cabecalho .topo { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .cabecalho .instituicao {
    font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
    font-size: ${Math.max(faixa.fonte - 0.5, 7)}px;
  }
  .cabecalho .lema { color: #5A6B7C; font-size: ${Math.max(faixa.fonte - 1, 6.5)}px; }
  .cabecalho .emissao { text-align: right; color: #44586C; font-size: ${Math.max(faixa.fonte - 0.5, 7)}px; }
  .cabecalho h1 { margin: 2px 0 0; font-size: ${faixa.fonte + 3}px; font-weight: 600; }
  .cabecalho .detalhes {
    display: flex; flex-wrap: wrap; gap: 2px 14px; color: #44586C;
    font-size: ${Math.max(faixa.fonte - 0.5, 7)}px; margin-top: 1px;
  }
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
    ${celulaTexto}
  }
  .right { text-align: right; }
  td.valor { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
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
  ${cabecalhoHtml(identificacao)}
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
    <span>${esc(textoRegistros(resultado.registros))}</span>
    ${total === null ? "<span></span>" : `<span>Total geral: ${esc(formatBRL(total))}</span>`}
  </div>
</body>
</html>`;
}

/**
 * Imprime o relatório em um documento próprio, sem interferir no CSS de impressão
 * das outras páginas do sistema.
 */
export function imprimirRelatorio({ titulo, subtitulo, resultado, cabecalho, modo, orientacao, maxPaginas }) {
  if (!resultado || resultado.registros === 0) return;

  const html = montarHtmlRelatorio({
    titulo,
    subtitulo,
    resultado,
    cabecalho,
    modo,
    orientacao,
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
const ALTURA_PAGINA_PT_PAISAGEM = 520; // A4 deitada (595pt) menos as margens

function escolherFaixaPdf(grupos, maxPaginas, orientacao) {
  const alturaFolha = orientacao === "landscape" ? ALTURA_PAGINA_PT_PAISAGEM : ALTURA_PAGINA_PT;
  const limite = alturaFolha * maxPaginas * 0.95;
  for (const faixa of FAIXAS_PDF) {
    const alturaLinha = faixa.fonte * 1.15 + faixa.pad * 2 + 1;
    let altura = 0;
    for (const grupo of grupos) altura += alturaLinha * (grupo.linhas.length + 3) + faixa.gap;
    if (altura + 40 <= limite) return faixa;
  }
  return FAIXAS_PDF[FAIXAS_PDF.length - 1];
}

/** PDF com o mesmo formato da impressão: grupos empilhados, um abaixo do outro. */
export function gerarPdfRelatorio({
  titulo,
  subtitulo,
  resultado,
  arquivo,
  cabecalho,
  modo,
  orientacao,
  maxPaginas,
}) {
  if (!resultado || resultado.registros === 0) return;

  const colunas = resultado.colunas;
  const formato = formatoDoDocumento({ modo, orientacao, colunas, maxPaginas });
  const grupos = resultado.grupos.filter((g) => g.linhas.length > 0);
  const faixa = escolherFaixaPdf(grupos, formato.maxPaginas, formato.orientacao);
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: formato.orientacao });
  const larguraPagina = doc.internal.pageSize.getWidth();
  const alturaPagina = doc.internal.pageSize.getHeight();
  const margem = 26;
  const larguraUtil = larguraPagina - margem * 2;
  const fonte = faixa.fonte;

  const identificacao = cabecalhoDoDocumento({ titulo, subtitulo, cabecalho });
  const detalhes = [
    identificacao.periodo ? `Período: ${identificacao.periodo}` : "",
    identificacao.filtros ? `Filtros: ${identificacao.filtros}` : "",
  ]
    .filter(Boolean)
    .join("   •   ");
  const emissor =
    identificacao.usuario !== "" ? `Emitido por ${identificacao.usuario}` : identificacao.avulso;

  // As linhas do detalhe são medidas uma vez só: a altura do cabeçalho é a mesma
  // em todas as páginas, então a tabela sempre começa na mesma posição.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(fonte - 1);
  const linhasDetalhe = detalhes ? doc.splitTextToSize(textoSimples(detalhes), larguraUtil).slice(0, 3) : [];
  const alturaCabecalho = fonte + 5 + (fonte + 3) + 6 + linhasDetalhe.length * (fonte + 1);

  /** Cabeçalho padronizado, repetido no topo de cada página. */
  const desenharCabecalho = () => {
    const direita = larguraPagina - margem;
    let y = margem + fonte;

    if (identificacao.instituicao) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(fonte - 0.5);
      doc.setTextColor(...COR_NAVY);
      doc.text(textoSimples(identificacao.instituicao.toUpperCase()), margem, y);
    }
    if (identificacao.geradoEm) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(fonte - 1);
      doc.setTextColor(...COR_CINZA);
      doc.text(textoSimples(`Gerado em ${identificacao.geradoEm}`), direita, y, { align: "right" });
    }

    y += fonte + 5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(fonte + 3);
    doc.setTextColor(...COR_NAVY);
    doc.text(textoSimples(identificacao.relatorio), margem, y);
    if (emissor) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(fonte - 1);
      doc.setTextColor(...COR_CINZA);
      doc.text(textoSimples(emissor), direita, y, { align: "right" });
    }

    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fonte - 1);
    doc.setTextColor(...COR_CINZA);
    linhasDetalhe.forEach((linha) => {
      y += fonte + 1;
      doc.text(linha, margem, y);
    });

    doc.setDrawColor(...COR_NAVY);
    doc.setLineWidth(0.8);
    doc.line(margem, margem + alturaCabecalho + 2, larguraPagina - margem, margem + alturaCabecalho + 2);
    doc.setTextColor(...COR_NAVY);
  };

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
  const topo = margem + alturaCabecalho + 10;
  // Faixa reservada no pé da folha para o total geral e a numeração de páginas.
  const rodapeReservado = margem + 12;
  let posicao = topo;

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
              ? textoRegistros(grupo.linhas.length)
              : `Total: ${textoSimples(formatBRLSimples(total))}`,
          styles: { halign: "right", fontStyle: "bold", fontSize: faixa.fonte + 1 },
        },
      ]);
    }
    cabecalhos.push(colunas.map((c) => ({ content: c.label, styles: { halign: alinhamento(c) } })));

    autoTable(doc, {
      startY: posicao,
      margin: { top: topo, left: margem, right: margem, bottom: rodapeReservado },
      theme: "grid",
      styles: {
        fontSize: faixa.fonte,
        cellPadding: faixa.pad,
        lineColor: [225, 229, 234],
        lineWidth: 0.4,
        textColor: COR_NAVY,
        // Na impressão detalhada o texto quebra em várias linhas em vez de ser cortado.
        overflow: formato.quebrarTexto ? "linebreak" : "ellipsize",
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
  const resumo = `${textoRegistros(resultado.registros)}${
    total === null ? "" : `   •   Total geral: ${formatBRLSimples(total)}`
  }`;

  // O rodapé é desenhado na faixa reservada de cada página, depois de o documento
  // estar fechado: assim a numeração sai exata ("Página 2 de 5") e nenhuma página
  // extra é criada só para caber o total.
  const paginas = doc.getNumberOfPages();
  const linhaRodape = alturaPagina - margem + fonte;
  for (let pagina = 1; pagina <= paginas; pagina++) {
    doc.setPage(pagina);
    if (pagina === paginas) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(fonte);
      doc.setTextColor(...COR_NAVY);
      doc.text(textoSimples(resumo), margem, linhaRodape);
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fonte - 1);
    doc.setTextColor(...COR_CINZA);
    doc.text(`Página ${pagina} de ${paginas}`, larguraPagina - margem, linhaRodape, { align: "right" });
  }

  doc.save(arquivo || "relatorio.pdf");
}

// --- Planilha ---
/**
 * Excel com uma linha por registro.
 *
 * Coluna de valor sai como NÚMERO com o formato de moeda brasileiro gravado na
 * célula (R$ #,##0.00). É o mesmo tratamento das planilhas de Programação e de
 * Baixas: quem recebe o arquivo vê "R$ 1.234,56" e a coluna soma na planilha,
 * porque nenhum valor viaja como texto.
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
        if (c.tipo === "moeda") registro[c.label] = paraNumeroMoeda(valor);
        else if (c.tipo === "numero") registro[c.label] = Number(valor ?? 0);
        else if (c.tipo === "data") registro[c.label] = formatarCelula(valor, "data");
        else registro[c.label] = String(valor ?? "");
      });
      linhas.push(registro);
    });
  });

  const planilha = XLSX.utils.json_to_sheet(linhas, { header: cabecalho });
  const rotulosDeMoeda = resultado.colunas.filter((c) => c.tipo === "moeda").map((c) => c.label);
  marcarColunasDeMoeda(planilha, colunasPorCabecalho(cabecalho, rotulosDeMoeda), {
    primeiraLinha: 1,
    ultimaLinha: linhas.length,
  });

  planilha["!cols"] = cabecalho.map((rotulo) => ({
    wch: Math.max(12, Math.min(40, String(rotulo).length + 4)),
  }));

  const arquivoExcel = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(arquivoExcel, planilha, "Relatorio");
  XLSX.writeFile(arquivoExcel, arquivo || `${titulo || "relatorio"}.xlsx`);
}
