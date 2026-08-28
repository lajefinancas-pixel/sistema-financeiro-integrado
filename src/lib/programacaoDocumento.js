import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatBRL, formatBRLSimples } from "./moeda.js";
import { ALTURA, MAXIMO_OBSERVACOES, MINIMO_OBSERVACOES, PAGINA, montarPaginas } from "./programacaoPaginacao.js";

// Documento da Programação Diária de Pagamentos -- o papel que vai à mesa do
// gestor. Não é a tela impressa: é um documento com layout próprio, A4 retrato,
// só com o que foi escolhido (contas selecionadas e fornecedores propostos).
// Nada de interface entra aqui.
//
// A paginação vem de programacaoPaginacao.js: as alturas usadas no cálculo são
// as mesmas declaradas no CSS abaixo. Assim o número de folhas é conhecido (dá
// para numerar "Página X de Y"), o cabeçalho da tabela repete em cada uma e
// nada é cortado.

export const COLUNAS_CONTAS = ["BANCO", "Nº DA CONTA", "SALDO", "NOME DA CONTA"];
export const COLUNAS_PAGAMENTOS = ["FORNECEDOR", "VALOR EM ABERTO", "VALOR A PAGAR", "APROVADO"];

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
    pagamentos: (bruto.pagamentos ?? []).map((item) => ({ fornecedor: item.fornecedor || "--", aberto: item.aberto === null || item.aberto === undefined ? null : numero(item.aberto), valor: numero(item.valor) })),
    totalContas: numero(bruto.totalContas),
    totalProgramado: numero(bruto.totalProgramado),
    restante: numero(bruto.restante),
  };
}

// --- Impressão (HTML) ------------------------------------------------------

function estilos() {
  return `
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { color: #1B211E; font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; line-height: 1.25;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .folha { position: relative; width: ${PAGINA.largura}mm; height: ${PAGINA.altura}mm; overflow: hidden;
      padding: ${PAGINA.margemTopo}mm ${PAGINA.margemLado}mm ${PAGINA.margemBase}mm; page-break-after: always; break-after: page; }
    .folha:last-child { page-break-after: auto; break-after: auto; }
    .cabecalho { height: ${ALTURA.cabecalhoInicial}mm; border-bottom: 1.6pt solid #263F36; }
    .cabecalho.seguinte { height: ${ALTURA.cabecalhoContinuacao}mm; border-bottom-width: .8pt; }
    .cabecalho h1 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 15pt; letter-spacing: .03em; text-align: center; }
    .cabecalho.seguinte h1 { font-size: 10pt; }
    .identificacao { display: flex; justify-content: space-between; gap: 6mm; margin-top: 2.4mm; font-size: 7.5pt; color: #3B4741; }
    .cabecalho.seguinte .identificacao { margin-top: 1mm; font-size: 7pt; }
    .identificacao span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .identificacao strong { color: #1B211E; }
    h2 { margin: 0; height: ${ALTURA.tituloBloco}mm; padding-top: 1.6mm; color: #263F36; font-size: 8pt;
      font-weight: bold; letter-spacing: .1em; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    th, td { border: .5pt solid #9AA49E; padding: 0 2mm; text-align: left; vertical-align: middle;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    th { height: ${ALTURA.linhaCabecalho}mm; background: #E7EBE7; color: #263F36; font-size: 6.8pt;
      font-weight: bold; letter-spacing: .05em; text-transform: uppercase; }
    .valor { text-align: right; font-variant-numeric: tabular-nums; }
    td.valor { font-weight: bold; }
    .contas td { height: ${ALTURA.linhaConta}mm; }
    .propostos td { height: ${ALTURA.linhaPagamento}mm; }
    .propostos td.aprovado { border-left: .5pt solid #9AA49E; }
    .vazia { text-align: center; color: #5B665F; font-weight: normal; }
    .total-contas { height: ${ALTURA.totalContas}mm; display: flex; align-items: center; justify-content: flex-end; gap: 6mm;
      border: .5pt solid #9AA49E; border-top: 0; background: #F1F3F0; padding: 0 2mm; font-size: 8.5pt; font-weight: bold; }
    .totais { height: ${ALTURA.totais}mm; display: flex; border: 1pt solid #263F36; border-top: 0; }
    .totais.com-diferenca { height: ${ALTURA.totaisComDiferenca}mm; flex-wrap: wrap; }
    .totais > div { flex: 1 1 0; min-width: 0; padding: 2mm; }
    .totais > div + div { border-left: .5pt solid #9AA49E; }
    .totais span { display: block; color: #45514A; font-size: 6.8pt; font-weight: bold; letter-spacing: .06em; text-transform: uppercase; }
    .totais strong { display: block; margin-top: 1.2mm; font-size: 11pt; font-variant-numeric: tabular-nums; }
    .diferenca { flex: 1 1 100%; border-left: 0 !important; border-top: .5pt solid #9AA49E; padding: 1.4mm 2mm !important;
      font-size: 7.5pt; color: #3B4741; }
    .observacoes h2 { height: ${ALTURA.tituloObservacoes}mm; }
    .linha-manuscrita { height: ${ALTURA.linhaObservacao}mm; border-bottom: .5pt solid #8E9992; }
    .assinaturas { height: ${ALTURA.assinaturas}mm; display: flex; align-items: flex-end; gap: 14mm; padding-bottom: 4mm; }
    .assinaturas div { flex: 1 1 0; border-top: .8pt solid #1B211E; padding-top: 1.6mm; text-align: center; font-size: 7.5pt; }
    .rodape { position: absolute; left: ${PAGINA.margemLado}mm; right: ${PAGINA.margemLado}mm; bottom: 5mm;
      display: flex; justify-content: space-between; gap: 6mm; border-top: .5pt solid #C3CAC5; padding-top: 1.2mm;
      color: #5B665F; font-size: 6.8pt; }
    .rodape span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `;
}

function cabecalhoHtml(dados, inicial) {
  if (!inicial) {
    return `<div class="cabecalho seguinte"><h1>${escapar(dados.titulo)}</h1><div class="identificacao"><span>${escapar(dados.secretaria)}</span><span>Programação de ${escapar(dados.data)}</span></div></div>`;
  }
  return `<div class="cabecalho"><h1>${escapar(dados.titulo)}</h1><div class="identificacao">`
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
    ? bloco.linhas.map((conta) => `<tr><td>${escapar(conta.banco)}</td><td>${escapar(conta.conta)}</td><td class="valor">${escapar(formatBRL(conta.saldo))}</td><td>${escapar(conta.nome)}</td></tr>`).join("")
    : '<tr><td class="vazia" colspan="4">Nenhuma conta selecionada.</td></tr>';
  return `<table class="contas"><colgroup><col style="width:26%"><col style="width:19%"><col style="width:22%"><col style="width:33%"></colgroup>`
    + `<thead><tr><th>${COLUNAS_CONTAS[0]}</th><th>${COLUNAS_CONTAS[1]}</th><th class="valor">${COLUNAS_CONTAS[2]}</th><th>${COLUNAS_CONTAS[3]}</th></tr></thead>`
    + `<tbody>${linhas}</tbody></table>`;
}

// A coluna APROVADO sai vazia de propósito: é ela que o gestor marca à mão.
function tabelaPagamentosHtml(bloco) {
  const linhas = bloco.linhas.length
    ? bloco.linhas.map((item) => `<tr><td>${escapar(item.fornecedor)}</td><td class="valor">${item.aberto === null ? "--" : escapar(formatBRL(item.aberto))}</td><td class="valor">${escapar(formatBRL(item.valor))}</td><td class="aprovado"></td></tr>`).join("")
    : '<tr><td class="vazia" colspan="4">Nenhum pagamento proposto.</td></tr>';
  return `<table class="propostos"><colgroup><col style="width:43%"><col style="width:19%"><col style="width:19%"><col style="width:19%"></colgroup>`
    + `<thead><tr><th>${COLUNAS_PAGAMENTOS[0]}</th><th class="valor">${COLUNAS_PAGAMENTOS[1]}</th><th class="valor">${COLUNAS_PAGAMENTOS[2]}</th><th>${COLUNAS_PAGAMENTOS[3]}</th></tr></thead>`
    + `<tbody>${linhas}</tbody></table>`;
}

// Programado acima do disponível: só a diferença, em texto normal. Nenhum
// destaque de alerta -- a decisão é do gestor, o documento apenas informa.
function totaisHtml(dados) {
  const diferenca = dados.restante < 0
    ? `<div class="diferenca">Diferença de ${escapar(formatBRL(Math.abs(dados.restante)))} acima do saldo das contas selecionadas.</div>`
    : "";
  return `<div class="totais${dados.restante < 0 ? " com-diferenca" : ""}">`
    + `<div><span>TOTAL DAS CONTAS</span><strong>${escapar(formatBRL(dados.totalContas))}</strong></div>`
    + `<div><span>TOTAL PROGRAMADO</span><strong>${escapar(formatBRL(dados.totalProgramado))}</strong></div>`
    + `<div><span>SALDO RESTANTE</span><strong>${escapar(formatBRL(dados.restante))}</strong></div>`
    + `${diferenca}</div>`;
}

function blocoHtml(bloco, dados) {
  if (bloco.tipo === "contas") return tituloBloco("contas", bloco.continuacao) + tabelaContasHtml(bloco);
  if (bloco.tipo === "pagamentos") return tituloBloco("pagamentos", bloco.continuacao) + tabelaPagamentosHtml(bloco);
  if (bloco.tipo === "totalContas") return `<div class="total-contas"><span>TOTAL DAS CONTAS:</span><span>${escapar(formatBRL(dados.totalContas))}</span></div>`;
  if (bloco.tipo === "totais") return totaisHtml(dados);
  if (bloco.tipo === "observacoes") {
    const linhas = Array.from({ length: bloco.quantidade }, () => '<div class="linha-manuscrita"></div>').join("");
    return `<div class="observacoes"><h2>OBSERVAÇÕES / ALTERAÇÕES</h2>${linhas}</div>`;
  }
  return '<div class="assinaturas"><div>Responsável pela elaboração</div><div>Aprovação</div></div>';
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

// Respiro entre as linhas de observação e a linha de assinatura.
const RESPIRO_ASSINATURA = 10;

const TINTA = { escura: [27, 33, 30], verde: [38, 63, 54], apoio: [69, 81, 74], linha: [154, 164, 158], faixa: [231, 235, 231] };

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

  const cabecalho = (primeira) => {
    pdf.setFont("times", "bold");
    pdf.setFontSize(primeira ? 15 : 10);
    pdf.setTextColor(...TINTA.verde);
    pdf.text(dados.titulo, largura / 2, primeira ? 17 : 14, { align: "center" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(primeira ? 7.5 : 7);
    pdf.setTextColor(...TINTA.apoio);
    if (primeira) {
      pdf.text(`Secretaria: ${texto(dados.secretaria)}`, margem, 23);
      pdf.text(`Data da programação: ${texto(dados.data)}`, largura / 2, 23, { align: "center" });
      pdf.text(`Emitido em: ${texto(dados.emissao)}`, largura - margem, 23, { align: "right" });
    } else {
      pdf.text(texto(dados.secretaria), margem, 19);
      pdf.text(`Programação de ${texto(dados.data)}`, largura - margem, 19, { align: "right" });
    }
    pdf.setDrawColor(...TINTA.verde);
    pdf.setLineWidth(primeira ? 0.6 : 0.3);
    pdf.line(margem, primeira ? 26 : 21, largura - margem, primeira ? 26 : 21);
  };

  const tituloSecao = (rotulo, y) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(...TINTA.verde);
    pdf.text(rotulo, margem, y);
  };

  const espacoOuPagina = (y, necessario) => {
    if (y + necessario <= altura - PAGINA.margemBase) return y;
    pdf.addPage();
    cabecalho(false);
    return 27;
  };

  cabecalho(true);

  const estiloTabela = {
    theme: "grid",
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: { top: 1, right: 1.6, bottom: 1, left: 1.6 }, textColor: TINTA.escura, lineColor: TINTA.linha, lineWidth: 0.2, overflow: "ellipsize" },
    headStyles: { fillColor: TINTA.faixa, textColor: TINTA.verde, fontStyle: "bold", fontSize: 6.8 },
    showHead: "everyPage",
    rowPageBreak: "avoid",
    margin: { top: 27, left: margem, right: margem, bottom: PAGINA.margemBase },
    didDrawPage: (dados2) => { if (dados2.pageNumber > 1) cabecalho(false); },
  };

  tituloSecao("CONTAS UTILIZADAS", 31);
  autoTable(pdf, {
    ...estiloTabela,
    startY: 33,
    head: [COLUNAS_CONTAS],
    body: dados.contas.length
      ? dados.contas.map((conta) => [texto(conta.banco), texto(conta.conta), formatBRLSimples(conta.saldo), texto(conta.nome)])
      : [[{ content: "Nenhuma conta selecionada.", colSpan: 4, styles: { halign: "center", textColor: TINTA.apoio } }]],
    columnStyles: {
      0: { cellWidth: util * 0.26 },
      1: { cellWidth: util * 0.19 },
      2: { cellWidth: util * 0.22, halign: "right", fontStyle: "bold" },
      3: { cellWidth: util * 0.33 },
    },
  });

  let y = pdf.lastAutoTable.finalY;
  pdf.setFillColor(...TINTA.faixa);
  pdf.setDrawColor(...TINTA.linha);
  pdf.setLineWidth(0.2);
  pdf.rect(margem, y, util, 7, "FD");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8.5);
  pdf.setTextColor(...TINTA.escura);
  pdf.text(`TOTAL DAS CONTAS: ${formatBRLSimples(dados.totalContas)}`, largura - margem - 2, y + 4.8, { align: "right" });
  y += 7;

  y = espacoOuPagina(y + 6, 18);
  tituloSecao("PAGAMENTOS PROPOSTOS", y);
  // A coluna APROVADO sai vazia e as linhas ficam altas: é onde o gestor
  // escreve à mão o que autoriza.
  autoTable(pdf, {
    ...estiloTabela,
    startY: y + 2,
    head: [COLUNAS_PAGAMENTOS],
    body: dados.pagamentos.length
      ? dados.pagamentos.map((item) => [texto(item.fornecedor), item.aberto === null ? "--" : formatBRLSimples(item.aberto), formatBRLSimples(item.valor), ""])
      : [[{ content: "Nenhum pagamento proposto.", colSpan: 4, styles: { halign: "center", textColor: TINTA.apoio } }]],
    styles: { ...estiloTabela.styles, minCellHeight: ALTURA.linhaPagamento, valign: "middle" },
    columnStyles: {
      0: { cellWidth: util * 0.43 },
      1: { cellWidth: util * 0.19, halign: "right" },
      2: { cellWidth: util * 0.19, halign: "right", fontStyle: "bold" },
      3: { cellWidth: util * 0.19 },
    },
  });

  y = pdf.lastAutoTable.finalY;
  const alturaTotais = dados.restante < 0 ? 22 : 16;
  y = espacoOuPagina(y, alturaTotais);
  pdf.setDrawColor(...TINTA.verde);
  pdf.setLineWidth(0.4);
  pdf.rect(margem, y, util, alturaTotais);
  const colunas = [
    ["TOTAL DAS CONTAS", dados.totalContas],
    ["TOTAL PROGRAMADO", dados.totalProgramado],
    ["SALDO RESTANTE", dados.restante],
  ];
  colunas.forEach(([rotulo, valor], indice) => {
    const x = margem + (util / 3) * indice;
    if (indice > 0) {
      pdf.setDrawColor(...TINTA.linha);
      pdf.setLineWidth(0.2);
      pdf.line(x, y, x, y + 16);
    }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(6.8);
    pdf.setTextColor(...TINTA.apoio);
    pdf.text(rotulo, x + 2, y + 4.5);
    pdf.setFontSize(11);
    pdf.setTextColor(...TINTA.escura);
    pdf.text(formatBRLSimples(valor), x + 2, y + 11.5);
  });
  if (dados.restante < 0) {
    pdf.setDrawColor(...TINTA.linha);
    pdf.setLineWidth(0.2);
    pdf.line(margem, y + 16, largura - margem, y + 16);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(...TINTA.apoio);
    pdf.text(`Diferença de ${formatBRLSimples(Math.abs(dados.restante))} acima do saldo das contas selecionadas.`, margem + 2, y + 20);
  }
  y += alturaTotais;

  y = espacoOuPagina(y + 6, 6 + ALTURA.linhaObservacao * MINIMO_OBSERVACOES + RESPIRO_ASSINATURA + ALTURA.assinaturas);
  tituloSecao("OBSERVAÇÕES / ALTERAÇÕES", y);
  const folga = altura - PAGINA.margemBase - ALTURA.assinaturas - RESPIRO_ASSINATURA - (y + 3);
  const quantidade = Math.min(MAXIMO_OBSERVACOES, Math.max(MINIMO_OBSERVACOES, Math.floor(folga / ALTURA.linhaObservacao)));
  pdf.setDrawColor(142, 153, 146);
  pdf.setLineWidth(0.2);
  for (let indice = 1; indice <= quantidade; indice += 1) pdf.line(margem, y + 3 + indice * ALTURA.linhaObservacao, largura - margem, y + 3 + indice * ALTURA.linhaObservacao);
  y = y + 3 + quantidade * ALTURA.linhaObservacao;

  y = espacoOuPagina(y + RESPIRO_ASSINATURA, ALTURA.assinaturas);
  const larguraAssinatura = (util - 14) / 2;
  pdf.setDrawColor(...TINTA.escura);
  pdf.setLineWidth(0.3);
  pdf.line(margem, y, margem + larguraAssinatura, y);
  pdf.line(largura - margem - larguraAssinatura, y, largura - margem, y);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.setTextColor(...TINTA.escura);
  pdf.text("Responsável pela elaboração", margem + larguraAssinatura / 2, y + 4, { align: "center" });
  pdf.text("Aprovação", largura - margem - larguraAssinatura / 2, y + 4, { align: "center" });

  const paginas = pdf.getNumberOfPages();
  for (let pagina = 1; pagina <= paginas; pagina += 1) {
    pdf.setPage(pagina);
    pdf.setDrawColor(195, 202, 197);
    pdf.setLineWidth(0.2);
    pdf.line(margem, altura - 10, largura - margem, altura - 10);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6.8);
    pdf.setTextColor(91, 102, 95);
    pdf.text(`${dados.titulo} — ${texto(dados.secretaria)} — ${texto(dados.data)}`, margem, altura - 6.5);
    pdf.text(`Página ${pagina} de ${paginas}`, largura - margem, altura - 6.5, { align: "right" });
  }

  pdf.save(`programacao-diaria-${texto(dados.data).replaceAll("/", "-")}.pdf`);
}
