import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { formatBRL, formatBRLSimples, marcarCelulasDeMoeda } from "./moeda.js";
import { ALTURA, PAGINA, alturaDoSaldoRestante, montarPaginas } from "./programacaoPaginacao.js";

// Documento da Programação Diária de Pagamentos -- o papel que vai à mesa do
// gestor. Não é a tela impressa: é um documento com layout próprio, A4 retrato,
// só com o que foi escolhido (contas selecionadas e fornecedores propostos).
// Nada de interface entra aqui.
//
// O documento é curto de propósito: contas utilizadas, pagamentos propostos em
// duas colunas, o somatório do programado logo abaixo da última linha de
// fornecedores e o saldo restante em destaque. Sem linhas para anotação e sem
// linhas de assinatura -- o papel não é assinado.
//
// A paginação vem de programacaoPaginacao.js: as alturas usadas no cálculo são
// as mesmas declaradas no CSS abaixo. Assim o número de folhas é conhecido (dá
// para numerar "Página X de Y"), o cabeçalho da tabela repete em cada uma e
// nada é cortado.

export const COLUNAS_CONTAS = ["BANCO", "Nº DA CONTA", "SALDO", "NOME DA CONTA"];
export const COLUNAS_PAGAMENTOS = ["FORNECEDOR", "VALOR"];

/**
 * Identidade visual do sistema, a mesma de relatoriosCabecalho.INSTITUICAO e do
 * topo da barra lateral. Repetida aqui como texto porque este arquivo é
 * carregado direto pelos testes, sem o resolvedor de módulos do Vite.
 */
export const IDENTIDADE = {
  orgao: "SECRETARIA DE FINANÇAS",
  lema: "GESTÃO QUE TRANSFORMA",
};

// Cores institucionais já em uso no sistema: o verde-escuro da tela de
// Pagamentos Diários, o ouro do brasão e a faixa clara do mesmo verde.
const COR = {
  verde: "#17352F",
  ouro: "#C9A227",
  faixa: "#E5EFEA",
  linha: "#D5DBDA",
  apoio: "#607671",
};

const TINTA = {
  verde: [23, 53, 47],
  ouro: [201, 162, 39],
  navy: [15, 42, 68],
  branco: [255, 255, 255],
  faixa: [229, 239, 234],
  linha: [213, 219, 218],
  apoio: [96, 118, 113],
  papel: [251, 250, 247],
};

// Proporção das duas colunas dos pagamentos propostos. O somatório e o quadro do
// saldo restante usam a mesma divisão, então os valores caem exatamente sob a
// coluna VALOR e a leitura funciona como soma de coluna.
const LARGURA_FORNECEDOR = 0.62;
const LARGURA_VALOR = 0.38;

function numero(valor) {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : 0;
}

function escapar(valor) {
  return String(valor ?? "").replace(/[&<>'"]/g, (caractere) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[caractere]));
}

/** "27/08/2026 14:32" -- data e hora da emissão do documento. */
export function agoraBR() {
  return new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function normalizar(dados) {
  const bruto = dados ?? {};
  return {
    titulo: bruto.titulo || "PROGRAMAÇÃO DIÁRIA DE PAGAMENTOS",
    secretaria: bruto.secretaria || "--",
    data: bruto.data || "--",
    emissao: bruto.emissao || agoraBR(),
    responsavel: bruto.responsavel || "--",
    contas: (bruto.contas ?? []).map((conta) => ({ banco: conta.banco || "--", conta: conta.conta || "--", saldo: numero(conta.saldo), nome: conta.nome || "--" })),
    pagamentos: (bruto.pagamentos ?? []).map((item) => ({ fornecedor: item.fornecedor || "--", valor: numero(item.valor) })),
    totalContas: numero(bruto.totalContas),
    totalProgramado: numero(bruto.totalProgramado),
    restante: numero(bruto.restante),
  };
}

// --- Brasão ----------------------------------------------------------------

/**
 * O brasão da Secretaria, o mesmo arquivo de public/brasao.svg. Vai embutido no
 * documento (e não por URL) para que a impressão nunca saia sem ele por causa de
 * uma imagem que ainda não carregou.
 */
function brasaoSvg(lado) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lado}mm" height="${lado}mm" viewBox="0 0 512 512" role="img" aria-label="Brasão da Secretaria de Finanças">`
    + `<rect width="512" height="512" rx="48" fill="#0F2A44"/>`
    + `<g transform="translate(76,64) scale(3)">`
    + `<g stroke="#C9A227" stroke-width="2" fill="none" opacity="0.9">`
    + `<path d="M 10,100 q -14,-6 -18,-18"/><path d="M 12,86 q -14,-6 -18,-18"/><path d="M 14,72 q -14,-6 -18,-18"/><path d="M 16,58 q -14,-6 -18,-18"/><path d="M 18,44 q -14,-6 -18,-18"/>`
    + `</g>`
    + `<g stroke="#C9A227" stroke-width="2" fill="none" opacity="0.9">`
    + `<path d="M 110,100 q 14,-6 18,-18"/><path d="M 108,86 q 14,-6 18,-18"/><path d="M 106,72 q 14,-6 18,-18"/><path d="M 104,58 q 14,-6 18,-18"/><path d="M 102,44 q 14,-6 18,-18"/>`
    + `</g>`
    + `<path d="M60 6 L63 15 L72 15 L65 21 L67 30 L60 25 L53 30 L55 21 L48 15 L57 15 Z" fill="#C9A227"/>`
    + `<path d="M60 22 L92 32 V70 C92 96 78 112 60 122 C42 112 28 96 28 70 V32 Z" fill="#FBFAF7" stroke="#0F2A44" stroke-width="3.5"/>`
    + `<text x="60" y="82" text-anchor="middle" font-size="46" font-style="italic" font-family="Georgia, 'Times New Roman', serif" fill="#0F2A44">F</text>`
    + `</g></svg>`;
}

// O mesmo brasão desenhado com primitivas do PDF: fundo navy, estrela e escudo
// com o "F". Os traços finos do louro ficam de fora -- a 14mm eles não aparecem.
function desenharBrasaoPdf(pdf, x, y, lado) {
  pdf.setFillColor(...TINTA.navy);
  pdf.roundedRect(x, y, lado, lado, lado * 0.09, lado * 0.09, "F");

  // Estrela, normalizada da caixa 48..72 / 6..30 do SVG.
  const estrela = [[3, 9], [9, 0], [-7, 6], [2, 9], [-7, -5], [-7, 5], [2, -9], [-7, -6], [9, 0]];
  pdf.setFillColor(...TINTA.ouro);
  pdf.lines(estrela.map(([dx, dy]) => [(dx / 24) * lado * 0.2, (dy / 24) * lado * 0.2]), x + lado * 0.5, y + lado * 0.1, [1, 1], "F", true);

  // Escudo, normalizado da caixa 28..92 / 22..122 do SVG.
  const larguraEscudo = lado * 0.5;
  const alturaEscudo = lado * 0.62;
  const escudo = [
    [0.5 * larguraEscudo, 0.1 * alturaEscudo],
    [0, 0.38 * alturaEscudo],
    [0, 0.26 * alturaEscudo, -0.21875 * larguraEscudo, 0.42 * alturaEscudo, -0.5 * larguraEscudo, 0.52 * alturaEscudo],
    [-0.28125 * larguraEscudo, -0.1 * alturaEscudo, -0.5 * larguraEscudo, -0.26 * alturaEscudo, -0.5 * larguraEscudo, -0.52 * alturaEscudo],
    [0, -0.38 * alturaEscudo],
    [0.5 * larguraEscudo, -0.1 * alturaEscudo],
  ];
  pdf.setFillColor(...TINTA.papel);
  pdf.lines(escudo, x + (lado - larguraEscudo) / 2 + larguraEscudo / 2, y + lado * 0.26, [1, 1], "F", true);

  pdf.setFont("times", "bolditalic");
  pdf.setFontSize(lado * 1.5);
  pdf.setTextColor(...TINTA.navy);
  pdf.text("F", x + lado / 2, y + lado * 0.74, { align: "center" });
}

// --- Impressão (HTML) ------------------------------------------------------

function estilos() {
  return `
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { color: ${COR.verde}; font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; line-height: 1.25;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .folha { position: relative; width: ${PAGINA.largura}mm; height: ${PAGINA.altura}mm; overflow: hidden;
      padding: ${PAGINA.margemTopo}mm ${PAGINA.margemLado}mm ${PAGINA.margemBase}mm; page-break-after: always; break-after: page; }
    .folha:last-child { page-break-after: auto; break-after: auto; }
    .cabecalho { height: ${ALTURA.cabecalhoInicial}mm; overflow: hidden; border-bottom: 1.6pt solid ${COR.verde}; }
    .cabecalho.seguinte { height: ${ALTURA.cabecalhoContinuacao}mm; border-bottom-width: .8pt; }
    .marca { display: flex; align-items: center; gap: 4mm; }
    .marca svg { display: block; flex: 0 0 auto; }
    .orgao { font-size: 8.5pt; font-weight: bold; letter-spacing: .14em; }
    .lema { margin-top: .3mm; color: ${COR.ouro}; font-size: 6.5pt; font-weight: bold; letter-spacing: .18em; }
    .cabecalho h1 { margin: 1.2mm 0 0; font-family: Georgia, "Times New Roman", serif; font-size: 13pt; letter-spacing: .02em; }
    .cabecalho.seguinte .marca { gap: 3mm; }
    .cabecalho.seguinte .orgao { font-size: 7pt; letter-spacing: .1em; }
    .cabecalho.seguinte h1 { margin: .4mm 0 0; font-size: 9pt; }
    .identificacao { display: flex; justify-content: space-between; gap: 6mm; margin-top: 1.8mm; font-size: 7.5pt; color: ${COR.apoio}; }
    .identificacao span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .identificacao strong { color: ${COR.verde}; }
    .continuacao { margin-left: auto; text-align: right; font-size: 7pt; color: ${COR.apoio}; }
    h2 { margin: 0; height: ${ALTURA.tituloBloco}mm; padding-top: 3mm; color: ${COR.verde}; font-size: 8pt;
      font-weight: bold; letter-spacing: .1em; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    th, td { border: .5pt solid ${COR.linha}; padding: 0 2mm; text-align: left; vertical-align: middle;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    th { height: ${ALTURA.linhaCabecalho}mm; background: ${COR.verde}; color: #fff; font-size: 6.8pt;
      font-weight: bold; letter-spacing: .06em; text-transform: uppercase; border-color: ${COR.verde}; }
    /* Faixas alternadas suaves: o olho não perde a linha ao atravessar a folha. */
    tbody tr:nth-child(even) td { background: ${COR.faixa}; }
    .valor { text-align: right; font-variant-numeric: tabular-nums; }
    td.valor { font-weight: bold; }
    /* O saldo das contas fica centralizado na coluna, e em negrito. */
    .saldo { text-align: center; font-variant-numeric: tabular-nums; }
    td.saldo { font-weight: bold; }
    .contas td { height: ${ALTURA.linhaConta}mm; }
    .propostos td { height: ${ALTURA.linhaPagamento}mm; }
    .vazia { text-align: center; color: ${COR.apoio}; font-weight: normal; background: #fff !important; }
    .total-contas { height: ${ALTURA.totalContas}mm; display: flex; align-items: center; justify-content: flex-end; gap: 4mm;
      border: .5pt solid ${COR.linha}; border-top: 0; background: ${COR.faixa}; padding: 0 2mm; font-size: 8pt; font-weight: bold; }
    /* Somatório da coluna VALOR: linha de fechamento logo abaixo do último
       fornecedor, na mesma coluna dos valores. */
    .somatorio td { height: ${ALTURA.totalProgramado}mm; border: 0; border-top: 1pt solid ${COR.verde}; background: #fff; }
    .somatorio .rotulo { text-align: right; font-size: 8pt; font-weight: bold; letter-spacing: .06em; text-transform: uppercase; }
    .somatorio .valor { font-size: 10.5pt; font-weight: bold; }
    /* Saldo restante: é o número que o gestor mais olha, então ganha o quadro na
       cor institucional e o corpo maior do documento. */
    .destaque td { border: 0; background: ${COR.verde}; color: #fff; }
    .destaque .rotulo { height: ${ALTURA.saldoRestante}mm; text-align: right; font-size: 8.5pt; font-weight: bold;
      letter-spacing: .1em; text-transform: uppercase; }
    .destaque .valor { height: ${ALTURA.saldoRestante}mm; font-size: 15pt; font-weight: bold; }
    .destaque .diferenca { height: ${ALTURA.saldoRestanteComDiferenca - ALTURA.saldoRestante}mm; padding-bottom: 1.4mm;
      text-align: right; font-size: 7.5pt; font-weight: normal; white-space: normal; }
    .rodape { position: absolute; left: ${PAGINA.margemLado}mm; right: ${PAGINA.margemLado}mm; bottom: 5mm;
      display: flex; justify-content: space-between; gap: 6mm; border-top: .5pt solid ${COR.linha}; padding-top: 1.2mm;
      color: ${COR.apoio}; font-size: 6.8pt; }
    .rodape span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `;
}

function cabecalhoHtml(dados, inicial) {
  if (!inicial) {
    return `<div class="cabecalho seguinte"><div class="marca">${brasaoSvg(8)}`
      + `<div><div class="orgao">${escapar(IDENTIDADE.orgao)}</div><h1>${escapar(dados.titulo)}</h1></div>`
      + `<div class="continuacao">${escapar(dados.secretaria)}<br>Programação de ${escapar(dados.data)}</div>`
      + `</div></div>`;
  }
  return `<div class="cabecalho"><div class="marca">${brasaoSvg(15)}`
    + `<div><div class="orgao">${escapar(IDENTIDADE.orgao)}</div><div class="lema">${escapar(IDENTIDADE.lema)}</div>`
    + `<h1>${escapar(dados.titulo)}</h1></div></div>`
    + `<div class="identificacao">`
    + `<span>Secretaria: <strong>${escapar(dados.secretaria)}</strong></span>`
    + `<span>Data da programação: <strong>${escapar(dados.data)}</strong></span>`
    + `<span>Emitido em: <strong>${escapar(dados.emissao)}</strong></span>`
    + `</div></div>`;
}

function tituloBloco(tipo, continuacao) {
  const nome = tipo === "contas" ? "Contas utilizadas" : "Pagamentos propostos";
  return `<h2>${nome}${continuacao ? " (continuação)" : ""}</h2>`;
}

function tabelaContasHtml(bloco) {
  const linhas = bloco.linhas.length
    ? bloco.linhas.map((conta) => `<tr><td>${escapar(conta.banco)}</td><td>${escapar(conta.conta)}</td><td class="saldo">${escapar(formatBRL(conta.saldo))}</td><td>${escapar(conta.nome)}</td></tr>`).join("")
    : '<tr><td class="vazia" colspan="4">Nenhuma conta selecionada.</td></tr>';
  return `<table class="contas"><colgroup><col style="width:26%"><col style="width:19%"><col style="width:22%"><col style="width:33%"></colgroup>`
    + `<thead><tr><th>${COLUNAS_CONTAS[0]}</th><th>${COLUNAS_CONTAS[1]}</th><th class="saldo">${COLUNAS_CONTAS[2]}</th><th>${COLUNAS_CONTAS[3]}</th></tr></thead>`
    + `<tbody>${linhas}</tbody></table>`;
}

const COLGROUP_PAGAMENTOS = `<colgroup><col style="width:${(LARGURA_FORNECEDOR * 100).toFixed(0)}%"><col style="width:${(LARGURA_VALOR * 100).toFixed(0)}%"></colgroup>`;

// Duas colunas e nada mais: fornecedor e valor. O documento é de leitura direta.
function tabelaPagamentosHtml(bloco) {
  const linhas = bloco.linhas.length
    ? bloco.linhas.map((item) => `<tr><td>${escapar(item.fornecedor)}</td><td class="valor">${escapar(formatBRL(item.valor))}</td></tr>`).join("")
    : '<tr><td class="vazia" colspan="2">Nenhum pagamento proposto.</td></tr>';
  return `<table class="propostos">${COLGROUP_PAGAMENTOS}`
    + `<thead><tr><th>${COLUNAS_PAGAMENTOS[0]}</th><th class="valor">${COLUNAS_PAGAMENTOS[1]}</th></tr></thead>`
    + `<tbody>${linhas}</tbody></table>`;
}

function somatorioHtml(dados) {
  return `<table class="somatorio">${COLGROUP_PAGAMENTOS}<tbody><tr>`
    + `<td class="rotulo">TOTAL PROGRAMADO:</td><td class="valor">${escapar(formatBRL(dados.totalProgramado))}</td>`
    + `</tr></tbody></table>`;
}

// Programado acima do disponível: só a diferença, em texto normal. Nenhum
// destaque de alerta -- a decisão é do gestor, o documento apenas informa.
function saldoRestanteHtml(dados) {
  const diferenca = dados.restante < 0
    ? `<tr><td class="diferenca" colspan="2">Diferença de ${escapar(formatBRL(Math.abs(dados.restante)))} acima do saldo das contas selecionadas.</td></tr>`
    : "";
  return `<table class="destaque">${COLGROUP_PAGAMENTOS}<tbody>`
    + `<tr><td class="rotulo">SALDO RESTANTE:</td><td class="valor">${escapar(formatBRL(dados.restante))}</td></tr>`
    + `${diferenca}</tbody></table>`;
}

function blocoHtml(bloco, dados) {
  if (bloco.tipo === "contas") return tituloBloco("contas", bloco.continuacao) + tabelaContasHtml(bloco);
  if (bloco.tipo === "pagamentos") return tituloBloco("pagamentos", bloco.continuacao) + tabelaPagamentosHtml(bloco);
  if (bloco.tipo === "totalContas") return `<div class="total-contas"><span>TOTAL DAS CONTAS:</span><span>${escapar(formatBRL(dados.totalContas))}</span></div>`;
  if (bloco.tipo === "totalProgramado") return somatorioHtml(dados);
  return saldoRestanteHtml(dados);
}

export function htmlProgramacao(entrada) {
  const dados = normalizar(entrada);
  const paginas = montarPaginas(dados);
  const folhas = paginas.map((pagina, indice) => {
    const rodape = `<div class="rodape"><span>${escapar(dados.titulo)} — ${escapar(dados.secretaria)} — ${escapar(dados.data)}</span><span>Página ${indice + 1} de ${paginas.length}</span></div>`;
    return `<div class="folha">${cabecalhoHtml(dados, pagina.inicial)}${pagina.blocos.map((bloco) => blocoHtml(bloco, dados)).join("")}${rodape}</div>`;
  }).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(dados.titulo)} — ${escapar(dados.data)}</title><style>${estilos()}</style></head><body>${folhas}</body></html>`;
}

/**
 * Imprime em um quadro próprio, fora da árvore da página: o CSS da tela não
 * interfere no documento e o documento não interfere na tela.
 */
export function imprimirProgramacao(entrada) {
  const html = htmlProgramacao(entrada);
  const quadro = document.createElement("iframe");
  quadro.setAttribute("aria-hidden", "true");
  quadro.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(quadro);

  const remover = () => { if (quadro.parentNode) quadro.parentNode.removeChild(quadro); };
  const documento = quadro.contentWindow.document;
  documento.open();
  documento.write(html);
  documento.close();

  const janela = quadro.contentWindow;
  janela.onafterprint = () => setTimeout(remover, 300);
  setTimeout(() => { janela.focus(); janela.print(); }, 150);
  setTimeout(remover, 60000); // rede de segurança caso o navegador não avise o fim da impressão
}

// --- PDF -------------------------------------------------------------------

function texto(valor) {
  return String(valor ?? "");
}

export function gerarPdfProgramacao(entrada) {
  const dados = normalizar(entrada);
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const largura = pdf.internal.pageSize.getWidth();
  const altura = pdf.internal.pageSize.getHeight();
  const margem = PAGINA.margemLado;
  const util = largura - margem * 2;
  const topo = PAGINA.margemTopo;
  // Onde a primeira folha e as folhas de continuação liberam espaço para o conteúdo.
  const inicioPrimeira = topo + ALTURA.cabecalhoInicial;
  const inicioSeguinte = topo + ALTURA.cabecalhoContinuacao;

  const cabecalho = (primeira) => {
    const lado = primeira ? 15 : 9;
    desenharBrasaoPdf(pdf, margem, topo, lado);
    const textoX = margem + lado + 4;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(primeira ? 8.5 : 7);
    pdf.setTextColor(...TINTA.verde);
    pdf.text(IDENTIDADE.orgao, textoX, topo + (primeira ? 4.6 : 3.6));

    if (primeira) {
      pdf.setFontSize(6.5);
      pdf.setTextColor(...TINTA.ouro);
      pdf.text(IDENTIDADE.lema, textoX, topo + 7.6);
    }

    pdf.setFont("times", "bold");
    pdf.setFontSize(primeira ? 13 : 9);
    pdf.setTextColor(...TINTA.verde);
    pdf.text(dados.titulo, textoX, topo + (primeira ? 12.6 : 7.6));

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(primeira ? 7.5 : 7);
    pdf.setTextColor(...TINTA.apoio);
    if (primeira) {
      const linha = topo + 20;
      pdf.text(`Secretaria: ${texto(dados.secretaria)}`, margem, linha);
      pdf.text(`Data da programação: ${texto(dados.data)}`, largura / 2, linha, { align: "center" });
      pdf.text(`Emitido em: ${texto(dados.emissao)}`, largura - margem, linha, { align: "right" });
    } else {
      pdf.text(texto(dados.secretaria), largura - margem, topo + 4, { align: "right" });
      pdf.text(`Programação de ${texto(dados.data)}`, largura - margem, topo + 7.6, { align: "right" });
    }

    pdf.setDrawColor(...TINTA.verde);
    pdf.setLineWidth(primeira ? 0.6 : 0.3);
    const regua = (primeira ? inicioPrimeira : inicioSeguinte) - 1.5;
    pdf.line(margem, regua, largura - margem, regua);
  };

  const tituloSecao = (rotulo, y) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(...TINTA.verde);
    pdf.text(rotulo, margem, y + 5);
    return y + ALTURA.tituloBloco;
  };

  const espacoOuPagina = (y, necessario) => {
    if (y + necessario <= altura - PAGINA.margemBase) return y;
    pdf.addPage();
    cabecalho(false);
    return inicioSeguinte;
  };

  cabecalho(true);

  const estiloTabela = {
    theme: "grid",
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: { top: 1, right: 1.6, bottom: 1, left: 1.6 }, textColor: TINTA.verde, lineColor: TINTA.linha, lineWidth: 0.2, overflow: "ellipsize" },
    // Cabeçalho de tabela na cor institucional, com texto claro.
    headStyles: { fillColor: TINTA.verde, textColor: TINTA.branco, fontStyle: "bold", fontSize: 6.8, lineColor: TINTA.verde },
    // Faixas alternadas suaves nas linhas.
    alternateRowStyles: { fillColor: TINTA.faixa },
    showHead: "everyPage",
    rowPageBreak: "avoid",
    margin: { top: inicioSeguinte, left: margem, right: margem, bottom: PAGINA.margemBase },
    didDrawPage: (evento) => { if (evento.pageNumber > 1) cabecalho(false); },
  };

  let y = tituloSecao("CONTAS UTILIZADAS", inicioPrimeira);
  autoTable(pdf, {
    ...estiloTabela,
    startY: y,
    head: [COLUNAS_CONTAS],
    body: dados.contas.length
      ? dados.contas.map((conta) => [texto(conta.banco), texto(conta.conta), formatBRLSimples(conta.saldo), texto(conta.nome)])
      : [[{ content: "Nenhuma conta selecionada.", colSpan: 4, styles: { halign: "center", textColor: TINTA.apoio } }]],
    columnStyles: {
      0: { cellWidth: util * 0.26 },
      1: { cellWidth: util * 0.19 },
      // Saldo centralizado na coluna e em negrito.
      2: { cellWidth: util * 0.22, halign: "center", fontStyle: "bold" },
      3: { cellWidth: util * 0.33 },
    },
  });

  y = pdf.lastAutoTable.finalY;
  pdf.setFillColor(...TINTA.faixa);
  pdf.setDrawColor(...TINTA.linha);
  pdf.setLineWidth(0.2);
  pdf.rect(margem, y, util, ALTURA.totalContas, "FD");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(...TINTA.verde);
  pdf.text(`TOTAL DAS CONTAS: ${formatBRLSimples(dados.totalContas)}`, largura - margem - 2, y + 4.4, { align: "right" });
  y += ALTURA.totalContas;

  y = espacoOuPagina(y, ALTURA.tituloBloco + ALTURA.linhaCabecalho + ALTURA.linhaPagamento);
  y = tituloSecao("PAGAMENTOS PROPOSTOS", y);
  autoTable(pdf, {
    ...estiloTabela,
    startY: y,
    head: [COLUNAS_PAGAMENTOS],
    body: dados.pagamentos.length
      ? dados.pagamentos.map((item) => [texto(item.fornecedor), formatBRLSimples(item.valor)])
      : [[{ content: "Nenhum pagamento proposto.", colSpan: 2, styles: { halign: "center", textColor: TINTA.apoio } }]],
    styles: { ...estiloTabela.styles, minCellHeight: ALTURA.linhaPagamento - 1, valign: "middle" },
    columnStyles: {
      0: { cellWidth: util * LARGURA_FORNECEDOR },
      1: { cellWidth: util * LARGURA_VALOR, halign: "right", fontStyle: "bold" },
    },
  });

  // Somatório e saldo restante andam juntos: alinhados na coluna dos valores,
  // logo abaixo da última linha de fornecedores.
  const alturaSaldo = alturaDoSaldoRestante(dados);
  y = espacoOuPagina(pdf.lastAutoTable.finalY, ALTURA.totalProgramado + alturaSaldo);
  const inicioValor = largura - margem - util * LARGURA_VALOR;

  pdf.setDrawColor(...TINTA.verde);
  pdf.setLineWidth(0.4);
  pdf.line(margem, y, largura - margem, y);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(...TINTA.verde);
  pdf.text("TOTAL PROGRAMADO:", inicioValor - 2, y + 5, { align: "right" });
  pdf.setFontSize(10.5);
  pdf.text(formatBRLSimples(dados.totalProgramado), largura - margem - 1.6, y + 5.2, { align: "right" });
  y += ALTURA.totalProgramado;

  pdf.setFillColor(...TINTA.verde);
  pdf.rect(margem, y, util, alturaSaldo, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8.5);
  pdf.setTextColor(...TINTA.branco);
  pdf.text("SALDO RESTANTE:", inicioValor - 2, y + 8.4, { align: "right" });
  pdf.setFontSize(15);
  pdf.text(formatBRLSimples(dados.restante), largura - margem - 1.6, y + 9, { align: "right" });
  if (dados.restante < 0) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.text(`Diferença de ${formatBRLSimples(Math.abs(dados.restante))} acima do saldo das contas selecionadas.`, largura - margem - 1.6, y + alturaSaldo - 2, { align: "right" });
  }

  const paginas = pdf.getNumberOfPages();
  for (let pagina = 1; pagina <= paginas; pagina += 1) {
    pdf.setPage(pagina);
    pdf.setDrawColor(...TINTA.linha);
    pdf.setLineWidth(0.2);
    pdf.line(margem, altura - 10, largura - margem, altura - 10);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6.8);
    pdf.setTextColor(...TINTA.apoio);
    pdf.text(`${dados.titulo} — ${texto(dados.secretaria)} — ${texto(dados.data)}`, margem, altura - 6.5);
    pdf.text(`Página ${pagina} de ${paginas}`, largura - margem, altura - 6.5, { align: "right" });
  }

  pdf.save(nomeDoArquivo(dados, "pdf"));
}

// --- Planilha --------------------------------------------------------------

export function nomeDoArquivo(dados, extensao) {
  return `programacao-diaria-${texto(dados?.data).replaceAll("/", "-")}.${extensao}`;
}

/** Date a partir de "dd/mm/aaaa" ou "dd/mm/aaaa hh:mm". Fora disso, null. */
function dataDeBR(valor) {
  const partes = String(valor ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[,\s]+(\d{2}):(\d{2}))?/);
  if (!partes) return null;
  const [, dia, mes, ano, hora, minuto] = partes;
  return new Date(Number(ano), Number(mes) - 1, Number(dia), Number(hora ?? 0), Number(minuto ?? 0));
}

/**
 * Planilha da programação, no mesmo padrão de exportação dos outros módulos:
 * valores em formato numérico de moeda (dá para somar na planilha, não é texto)
 * e datas em formato de data. Os totais saem como fórmula de soma, então a
 * planilha continua conferindo sozinha se alguém alterar uma linha.
 *
 * Devolve a planilha montada e o nome do arquivo; quem grava é
 * `exportarExcelProgramacao`.
 */
export function montarPlanilhaProgramacao(entrada) {
  const dados = normalizar(entrada);
  const linhas = [];
  const moeda = [];
  const datas = [];

  const emissao = dataDeBR(dados.emissao);
  const programacao = dataDeBR(dados.data);

  linhas.push([`${IDENTIDADE.orgao} — ${IDENTIDADE.lema}`]);
  linhas.push([dados.titulo]);
  linhas.push([]);
  linhas.push(["Secretaria", dados.secretaria]);
  linhas.push(["Data da programação", programacao ?? dados.data]);
  if (programacao) datas.push({ linha: linhas.length - 1, coluna: 1, formato: "dd/mm/yyyy" });
  linhas.push(["Emitido em", emissao ?? dados.emissao]);
  if (emissao) datas.push({ linha: linhas.length - 1, coluna: 1, formato: "dd/mm/yyyy hh:mm" });
  linhas.push([]);

  linhas.push(["CONTAS UTILIZADAS"]);
  linhas.push(["Banco", "Nº da Conta", "Saldo", "Nome da Conta"]);
  const primeiraConta = linhas.length;
  dados.contas.forEach((conta) => {
    linhas.push([conta.banco, conta.conta, conta.saldo, conta.nome]);
    moeda.push({ linha: linhas.length - 1, coluna: 2 });
  });
  const ultimaConta = linhas.length - 1;
  linhas.push(["TOTAL DAS CONTAS", "", dados.totalContas, ""]);
  const linhaTotalContas = linhas.length - 1;
  moeda.push({
    linha: linhaTotalContas,
    coluna: 2,
    formula: dados.contas.length ? `SUM(C${primeiraConta + 1}:C${ultimaConta + 1})` : null,
  });
  linhas.push([]);

  linhas.push(["PAGAMENTOS PROPOSTOS"]);
  linhas.push(["Fornecedor", "Valor"]);
  const primeiroPagamento = linhas.length;
  dados.pagamentos.forEach((item) => {
    linhas.push([item.fornecedor, item.valor]);
    moeda.push({ linha: linhas.length - 1, coluna: 1 });
  });
  const ultimoPagamento = linhas.length - 1;
  linhas.push(["TOTAL PROGRAMADO", dados.totalProgramado]);
  const linhaTotalProgramado = linhas.length - 1;
  moeda.push({
    linha: linhaTotalProgramado,
    coluna: 1,
    formula: dados.pagamentos.length ? `SUM(B${primeiroPagamento + 1}:B${ultimoPagamento + 1})` : null,
  });
  linhas.push([]);

  linhas.push(["SALDO RESTANTE", dados.restante]);
  moeda.push({
    linha: linhas.length - 1,
    coluna: 1,
    formula: `C${linhaTotalContas + 1}-B${linhaTotalProgramado + 1}`,
  });

  const planilha = XLSX.utils.aoa_to_sheet(linhas, { cellDates: true });

  marcarCelulasDeMoeda(planilha, moeda);
  datas.forEach(({ linha, coluna, formato }) => {
    const celula = planilha[XLSX.utils.encode_cell({ r: linha, c: coluna })];
    if (!celula) return;
    celula.t = "d";
    celula.z = formato;
  });

  planilha["!cols"] = [{ wch: 34 }, { wch: 20 }, { wch: 18 }, { wch: 34 }];

  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, planilha, "Programação");
  return { livro, planilha, arquivo: nomeDoArquivo(dados, "xlsx") };
}

export function exportarExcelProgramacao(entrada) {
  const { livro, arquivo } = montarPlanilhaProgramacao(entrada);
  XLSX.writeFile(livro, arquivo, { cellDates: true });
}
