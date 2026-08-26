import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { agoraBR } from "./saldosDocumento";
import { INSTITUICAO } from "./relatoriosCabecalho";
import { formatarDataBR } from "./relatoriosCatalogo";
import { formatBRL, formatBRLSimples, paraNumeroMoeda } from "./moeda";

// Documento da Programação Diária de Pagamentos: impressão e PDF.
//
// Este é o papel que vai fisicamente à mesa do gestor para ele decidir quais
// fornecedores serão pagos no dia. Por isso o documento é montado do zero, e não
// a partir da tela: nada de campo de busca, filtro, botão, seleção, aba ou menu
// lateral aparece aqui. A folha tem só o que se lê e se assina.
//
// A geração segue o mesmo padrão das outras telas do sistema (Saldos, Certidões,
// Relatórios): a impressão escreve um documento próprio em um iframe oculto, sem
// mexer no CSS de impressão do restante do sistema, e o PDF sai do jsPDF com o
// mesmo layout. Cabeçalho institucional, valores em real brasileiro, datas em
// dd/mm/aaaa e numeração de páginas também vêm desse padrão.

const COR_NAVY = [15, 42, 68];
const COR_CINZA = [90, 107, 124];

export const TITULO_DOCUMENTO = "PROGRAMAÇÃO DE PAGAMENTOS";

export const COLUNAS_CONTAS = ["NOME DA CONTA", "BANCO", "Nº DA CONTA", "SALDO ATUAL"];
export const COLUNAS_FORNECEDORES = ["FORNECEDOR", "VALOR EM ABERTO", "VALOR A PAGAR", "APROVADO"];

// Linhas de pauta reservadas para o gestor escrever à mão os fornecedores que
// não estavam na relação.
const LINHAS_OBSERVACOES = 6;

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const numero = (valor) => Math.round(paraNumeroMoeda(valor) * 100) / 100;
const somar = (valores) => valores.reduce((total, valor) => total + numero(valor), 0);

/** Traço quando o fornecedor não é cadastrado e não tem valor em aberto conhecido. */
function textoValorEmAberto(valor, moeda) {
  if (valor === null || valor === undefined || valor === "") return "--";
  return moeda(valor);
}

/**
 * Normaliza o que a tela mandou para o formato único usado pela impressão e pelo
 * PDF. Só as contas MARCADAS para o dia entram aqui -- a lista completa de contas
 * disponíveis nunca vai ao papel.
 */
export function dadosDoDocumento(dados = {}) {
  const contas = (dados.contas ?? []).map((conta) => ({
    nome_conta: String(conta.nome_conta ?? "").trim() || "Conta sem nome",
    banco: String(conta.banco ?? "").trim() || "--",
    numero_conta: String(conta.numero_conta ?? "").trim() || "--",
    saldo: numero(conta.saldo),
  }));

  const fornecedores = (dados.fornecedores ?? []).map((item) => ({
    nome: String(item.nome ?? "").trim() || "Fornecedor não cadastrado",
    valorEmAberto:
      item.valorEmAberto === null || item.valorEmAberto === undefined || item.valorEmAberto === ""
        ? null
        : numero(item.valorEmAberto),
    valorAPagar: numero(item.valorAPagar),
  }));

  const totalDisponivel =
    dados.totalDisponivel === undefined || dados.totalDisponivel === null
      ? somar(contas.map((conta) => conta.saldo))
      : numero(dados.totalDisponivel);
  const totalPagar =
    dados.totalPagar === undefined || dados.totalPagar === null
      ? somar(fornecedores.map((item) => item.valorAPagar))
      : numero(dados.totalPagar);

  return {
    secretaria: String(dados.secretaria ?? "").trim() || INSTITUICAO.nome,
    lema: String(dados.lema ?? INSTITUICAO.lema).trim(),
    nomeProgramacao: String(dados.nomeProgramacao ?? "").trim() || "Programação sem nome",
    dataProgramacao: formatarDataBR(dados.dataProgramacao),
    geradoEm: String(dados.geradoEm ?? "").trim() || agoraBR(),
    usuario: String(dados.usuario ?? "").trim(),
    contas,
    fornecedores,
    totalDisponivel,
    totalPagar,
    diferenca: numero(totalDisponivel - totalPagar),
  };
}

/** "programacao-pagamentos-2026-08-26" */
export function nomeArquivoProgramacao(dataProgramacao) {
  const iso = String(dataProgramacao ?? "").slice(0, 10);
  return `programacao-pagamentos-${/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : "sem-data"}`;
}

/* -------------------------------------------------------------------------
 * Impressão (HTML em documento próprio)
 * ---------------------------------------------------------------------- */

function linhasDeContasHtml(contas) {
  if (contas.length === 0) {
    return `<tr><td colspan="4" class="vazio">Nenhuma conta marcada para o dia.</td></tr>`;
  }
  return contas
    .map(
      (conta) => `<tr>
        <td>${esc(conta.nome_conta)}</td>
        <td>${esc(conta.banco)}</td>
        <td>${esc(conta.numero_conta)}</td>
        <td class="valor">${esc(formatBRL(conta.saldo))}</td>
      </tr>`
    )
    .join("");
}

function linhasDeFornecedoresHtml(fornecedores) {
  if (fornecedores.length === 0) {
    return `<tr><td colspan="4" class="vazio">Nenhum fornecedor na relação.</td></tr>`;
  }
  return fornecedores
    .map(
      (item) => `<tr>
        <td class="fornecedor">${esc(item.nome)}</td>
        <td class="valor">${esc(textoValorEmAberto(item.valorEmAberto, formatBRL))}</td>
        <td class="valor">${esc(formatBRL(item.valorAPagar))}</td>
        <td class="aprovado"></td>
      </tr>`
    )
    .join("");
}

/** Documento A4 retrato completo, pronto para ir ao papel. */
export function montarHtmlProgramacao(entrada) {
  const d = dadosDoDocumento(entrada);
  const pauta = Array.from({ length: LINHAS_OBSERVACOES }, () => `<div class="pauta"></div>`).join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${esc(TITULO_DOCUMENTO)} — ${esc(d.dataProgramacao)}</title>
<style>
  @page {
    size: A4 portrait;
    margin: 14mm 13mm 16mm;
    /* Numeração para os motores de impressão que suportam caixa de margem; nos
       demais (Chrome, por exemplo) a própria janela de impressão oferece o
       rodapé com o número da página. O PDF numera sempre. */
    @bottom-right { content: "Página " counter(page) " de " counter(pages); font-size: 8.5pt; color: #5A6B7C; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: #0F2A44; font-size: 10.5pt; line-height: 1.35;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  /* --- Cabeçalho --- */
  .cabecalho { border-bottom: 1.5px solid #0F2A44; padding-bottom: 6px; margin-bottom: 14px; }
  .cabecalho .topo { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .cabecalho .instituicao { font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; font-size: 10pt; }
  .cabecalho .lema { color: #5A6B7C; font-size: 8.5pt; }
  .cabecalho .emissao { text-align: right; color: #44586C; font-size: 8.5pt; }
  .cabecalho h1 {
    margin: 10px 0 2px; font-size: 16pt; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .cabecalho .programacao { font-size: 11.5pt; font-weight: 600; }
  .cabecalho .data { color: #44586C; font-size: 9.5pt; }
  /* --- Blocos --- */
  .bloco { margin-bottom: 16px; }
  .bloco h2 {
    margin: 0 0 6px; font-size: 10.5pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.08em; color: #0F2A44;
    /* O título nunca fica sozinho no pé da folha, separado da sua tabela. */
    break-after: avoid; page-break-after: avoid;
  }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  /* O título das colunas fica no <thead>: se a relação continuar na página
     seguinte, o cabeçalho da tabela se repete e nenhuma linha fica órfã. */
  thead { display: table-header-group; }
  /* O total sai uma vez só, no fim da tabela -- e não repetido a cada página. */
  tfoot { display: table-row-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th {
    text-align: left; font-weight: 700; font-size: 8.5pt; text-transform: uppercase;
    letter-spacing: 0.04em; color: #0F2A44; background: #EEF1F5;
    border: 1px solid #B9C2CC; padding: 5px 6px;
  }
  td {
    padding: 5px 6px; border: 1px solid #C9CFD6; vertical-align: middle;
    word-break: break-word;
  }
  th.valor, td.valor { text-align: right; }
  td.valor { font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.vazio { text-align: center; color: #5A6B7C; padding: 10px 6px; }
  /* Contas selecionadas */
  .contas .c-nome { width: 38%; } .contas .c-banco { width: 24%; }
  .contas .c-numero { width: 17%; } .contas .c-saldo { width: 21%; }
  .contas tfoot td {
    border-top: 1.5px solid #0F2A44; font-weight: 700; font-size: 11pt;
    text-transform: uppercase; background: #F3F6F9;
  }
  /* Relação de fornecedores: linhas altas, com espaço para anotação à mão. */
  .fornecedores .c-fornecedor { width: 40%; } .fornecedores .c-aberto { width: 18%; }
  .fornecedores .c-pagar { width: 18%; } .fornecedores .c-aprovado { width: 24%; }
  .fornecedores tbody td { height: 46px; }
  .fornecedores td.fornecedor { font-weight: 600; }
  .fornecedores td.aprovado { background: #FFFFFF; }
  /* --- Totais --- */
  .totais { border: 1.5px solid #0F2A44; padding: 10px 12px; break-inside: avoid; page-break-inside: avoid; }
  .totais .linha {
    display: flex; justify-content: space-between; gap: 20px;
    font-size: 11.5pt; padding: 3px 0;
  }
  .totais .linha span:first-child { text-transform: uppercase; letter-spacing: 0.04em; }
  .totais .linha strong { font-variant-numeric: tabular-nums; }
  .totais .diferenca { border-top: 1px solid #B9C2CC; margin-top: 4px; padding-top: 6px; font-weight: 700; }
  /* --- Observações e assinaturas --- */
  .observacoes { break-inside: avoid; page-break-inside: avoid; }
  .observacoes .moldura { border: 1px solid #B9C2CC; padding: 8px 10px 2px; }
  .observacoes .pauta { border-bottom: 1px solid #D9DEE4; height: 26px; }
  .observacoes .pauta:last-child { border-bottom: 0; }
  .assinaturas {
    margin-top: 26px; display: flex; justify-content: space-between; gap: 40px;
    break-inside: avoid; page-break-inside: avoid;
  }
  .assinaturas div { flex: 1; text-align: center; }
  .assinaturas .linha { border-top: 1px solid #0F2A44; margin-bottom: 5px; }
  .assinaturas small { font-size: 9pt; color: #44586C; }
</style>
</head>
<body>
  <header class="cabecalho">
    <div class="topo">
      <div>
        <div class="instituicao">${esc(d.secretaria)}</div>
        ${d.lema ? `<div class="lema">${esc(d.lema)}</div>` : ""}
      </div>
      <div class="emissao">
        <div>Emitido em ${esc(d.geradoEm)}</div>
        ${d.usuario ? `<div>Emitido por ${esc(d.usuario)}</div>` : ""}
      </div>
    </div>
    <h1>${esc(TITULO_DOCUMENTO)}</h1>
    <div class="programacao">${esc(d.nomeProgramacao)}</div>
    <div class="data">Data da programação: ${esc(d.dataProgramacao)}</div>
  </header>

  <section class="bloco contas">
    <h2>Contas selecionadas</h2>
    <table>
      <colgroup>
        <col class="c-nome"><col class="c-banco"><col class="c-numero"><col class="c-saldo">
      </colgroup>
      <thead>
        <tr>
          <th>${esc(COLUNAS_CONTAS[0])}</th><th>${esc(COLUNAS_CONTAS[1])}</th>
          <th>${esc(COLUNAS_CONTAS[2])}</th><th class="valor">${esc(COLUNAS_CONTAS[3])}</th>
        </tr>
      </thead>
      <tbody>${linhasDeContasHtml(d.contas)}</tbody>
      <tfoot>
        <tr>
          <td colspan="3">Total disponível hoje</td>
          <td class="valor">${esc(formatBRL(d.totalDisponivel))}</td>
        </tr>
      </tfoot>
    </table>
  </section>

  <section class="bloco fornecedores">
    <h2>Relação de fornecedores</h2>
    <table>
      <colgroup>
        <col class="c-fornecedor"><col class="c-aberto"><col class="c-pagar"><col class="c-aprovado">
      </colgroup>
      <thead>
        <tr>
          <th>${esc(COLUNAS_FORNECEDORES[0])}</th><th class="valor">${esc(COLUNAS_FORNECEDORES[1])}</th>
          <th class="valor">${esc(COLUNAS_FORNECEDORES[2])}</th><th>${esc(COLUNAS_FORNECEDORES[3])}</th>
        </tr>
      </thead>
      <tbody>${linhasDeFornecedoresHtml(d.fornecedores)}</tbody>
    </table>
  </section>

  <section class="bloco totais">
    <div class="linha"><span>Total disponível</span><strong>${esc(formatBRL(d.totalDisponivel))}</strong></div>
    <div class="linha"><span>Total a pagar</span><strong>${esc(formatBRL(d.totalPagar))}</strong></div>
    <div class="linha diferenca"><span>Diferença</span><strong>${esc(formatBRL(d.diferenca))}</strong></div>
  </section>

  <section class="bloco observacoes">
    <h2>Observações</h2>
    <div class="moldura">${pauta}</div>
  </section>

  <section class="assinaturas">
    <div><div class="linha"></div><small>Responsável pela elaboração</small></div>
    <div><div class="linha"></div><small>Aprovação</small></div>
  </section>
</body>
</html>`;
}

/**
 * Imprime a programação em um documento próprio, dentro de um iframe oculto:
 * a tela não é capturada e o CSS de impressão das outras páginas do sistema
 * continua intocado.
 */
export function imprimirProgramacao(entrada) {
  const html = montarHtmlProgramacao(entrada);

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
  return true;
}

/* -------------------------------------------------------------------------
 * PDF (mesmo layout da impressão)
 * ---------------------------------------------------------------------- */

const MARGEM = 40; // ~14mm
const FONTE = 10;
const ALTURA_LINHA_FORNECEDOR = 34; // ~12mm: espaço para anotação à mão ao lado do fornecedor

export function gerarPdfProgramacao(entrada) {
  const d = dadosDoDocumento(entrada);
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const larguraPagina = doc.internal.pageSize.getWidth();
  const alturaPagina = doc.internal.pageSize.getHeight();
  const larguraUtil = larguraPagina - MARGEM * 2;
  const direita = larguraPagina - MARGEM;
  const rodapeReservado = MARGEM + 14;

  // O cabeçalho tem altura fixa, então as tabelas começam sempre na mesma linha,
  // em qualquer página.
  const alturaCabecalho = 92;
  const topo = MARGEM + alturaCabecalho;

  const desenharCabecalho = () => {
    let y = MARGEM + FONTE;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONTE);
    doc.setTextColor(...COR_NAVY);
    doc.text(d.secretaria.toLocaleUpperCase("pt-BR"), MARGEM, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONTE - 1.5);
    doc.setTextColor(...COR_CINZA);
    doc.text(`Emitido em ${d.geradoEm}`, direita, y, { align: "right" });
    if (d.lema) doc.text(d.lema, MARGEM, y + 11);
    if (d.usuario) doc.text(`Emitido por ${d.usuario}`, direita, y + 11, { align: "right" });

    y += 36;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONTE + 5);
    doc.setTextColor(...COR_NAVY);
    doc.text(TITULO_DOCUMENTO, MARGEM, y);

    y += 16;
    doc.setFontSize(FONTE + 1);
    doc.text(d.nomeProgramacao, MARGEM, y);

    y += 13;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONTE - 1);
    doc.setTextColor(...COR_CINZA);
    doc.text(`Data da programação: ${d.dataProgramacao}`, MARGEM, y);

    doc.setDrawColor(...COR_NAVY);
    doc.setLineWidth(1);
    doc.line(MARGEM, MARGEM + alturaCabecalho - 12, direita, MARGEM + alturaCabecalho - 12);
    doc.setTextColor(...COR_NAVY);
  };

  const tituloDoBloco = (texto, y) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONTE);
    doc.setTextColor(...COR_NAVY);
    doc.text(texto.toLocaleUpperCase("pt-BR"), MARGEM, y);
    return y + 8;
  };

  /** Abre uma página nova (com cabeçalho) quando o bloco não cabe no que resta. */
  const garantirEspaco = (y, altura) => {
    if (y + altura <= alturaPagina - rodapeReservado) return y;
    doc.addPage();
    desenharCabecalho();
    return topo;
  };

  const estiloBase = {
    font: "helvetica",
    fontSize: FONTE - 1,
    cellPadding: 4,
    lineColor: [185, 194, 204],
    lineWidth: 0.5,
    textColor: COR_NAVY,
    overflow: "linebreak",
    valign: "middle",
  };
  const estiloCabecalhoTabela = {
    fillColor: [238, 241, 245],
    textColor: COR_NAVY,
    fontStyle: "bold",
    fontSize: FONTE - 2,
  };

  // --- Bloco 1: contas selecionadas (somente as marcadas para o dia) ---
  let posicao = tituloDoBloco("Contas selecionadas", topo);

  autoTable(doc, {
    startY: posicao,
    margin: { top: topo, left: MARGEM, right: MARGEM, bottom: rodapeReservado },
    theme: "grid",
    styles: estiloBase,
    headStyles: estiloCabecalhoTabela,
    footStyles: { fillColor: [243, 246, 249], textColor: COR_NAVY, fontStyle: "bold", fontSize: FONTE },
    columnStyles: {
      0: { cellWidth: larguraUtil * 0.38 },
      1: { cellWidth: larguraUtil * 0.24 },
      2: { cellWidth: larguraUtil * 0.17 },
      3: { cellWidth: larguraUtil * 0.21, halign: "right" },
    },
    showHead: "everyPage",
    rowPageBreak: "avoid",
    head: [COLUNAS_CONTAS],
    body:
      d.contas.length === 0
        ? [[{ content: "Nenhuma conta marcada para o dia.", colSpan: 4, styles: { halign: "center", textColor: COR_CINZA } }]]
        : d.contas.map((conta) => [
            conta.nome_conta,
            conta.banco,
            conta.numero_conta,
            formatBRLSimples(conta.saldo),
          ]),
    foot: [
      [
        { content: "TOTAL DISPONÍVEL HOJE", colSpan: 3 },
        { content: formatBRLSimples(d.totalDisponivel), styles: { halign: "right" } },
      ],
    ],
    didDrawPage: desenharCabecalho,
  });

  // --- Bloco 2: relação de fornecedores ---
  posicao = garantirEspaco(doc.lastAutoTable.finalY + 22, 90);
  posicao = tituloDoBloco("Relação de fornecedores", posicao);

  autoTable(doc, {
    startY: posicao,
    margin: { top: topo, left: MARGEM, right: MARGEM, bottom: rodapeReservado },
    theme: "grid",
    // Linhas altas: o gestor escreve ao lado de cada fornecedor.
    styles: { ...estiloBase, fontSize: FONTE, minCellHeight: ALTURA_LINHA_FORNECEDOR },
    headStyles: estiloCabecalhoTabela,
    columnStyles: {
      0: { cellWidth: larguraUtil * 0.4, fontStyle: "bold" },
      1: { cellWidth: larguraUtil * 0.18, halign: "right" },
      2: { cellWidth: larguraUtil * 0.18, halign: "right" },
      3: { cellWidth: larguraUtil * 0.24 },
    },
    showHead: "everyPage",
    rowPageBreak: "avoid",
    head: [COLUNAS_FORNECEDORES],
    body:
      d.fornecedores.length === 0
        ? [[{ content: "Nenhum fornecedor na relação.", colSpan: 4, styles: { halign: "center", textColor: COR_CINZA } }]]
        : d.fornecedores.map((item) => [
            item.nome,
            textoValorEmAberto(item.valorEmAberto, formatBRLSimples),
            formatBRLSimples(item.valorAPagar),
            "", // APROVADO: espaço em branco, marcado à mão
          ]),
    didDrawPage: desenharCabecalho,
  });

  // --- Bloco 3: totais ---
  const alturaTotais = 66;
  posicao = garantirEspaco(doc.lastAutoTable.finalY + 22, alturaTotais);

  doc.setDrawColor(...COR_NAVY);
  doc.setLineWidth(1);
  doc.rect(MARGEM, posicao, larguraUtil, alturaTotais);

  const linhaDeTotal = (rotulo, valor, y, destaque) => {
    doc.setFont("helvetica", destaque ? "bold" : "normal");
    doc.setFontSize(FONTE + 1);
    doc.setTextColor(...COR_NAVY);
    doc.text(rotulo, MARGEM + 10, y);
    doc.text(formatBRLSimples(valor), direita - 10, y, { align: "right" });
  };

  linhaDeTotal("TOTAL DISPONÍVEL", d.totalDisponivel, posicao + 18, false);
  linhaDeTotal("TOTAL A PAGAR", d.totalPagar, posicao + 36, false);
  doc.setDrawColor(185, 194, 204);
  doc.setLineWidth(0.5);
  doc.line(MARGEM + 10, posicao + 44, direita - 10, posicao + 44);
  // A diferença negativa é apenas informada: a proposta continua em avaliação.
  linhaDeTotal("DIFERENÇA", d.diferenca, posicao + 58, true);
  posicao += alturaTotais;

  // --- Bloco 4: observações (pauta para inclusão manuscrita) ---
  const alturaObservacoes = LINHAS_OBSERVACOES * 24;
  posicao = garantirEspaco(posicao + 22, alturaObservacoes + 20);
  posicao = tituloDoBloco("Observações", posicao);

  doc.setDrawColor(185, 194, 204);
  doc.setLineWidth(0.5);
  doc.rect(MARGEM, posicao, larguraUtil, alturaObservacoes);
  doc.setDrawColor(217, 222, 228);
  for (let linha = 1; linha < LINHAS_OBSERVACOES; linha++) {
    const y = posicao + linha * 24;
    doc.line(MARGEM + 8, y, direita - 8, y);
  }
  posicao += alturaObservacoes;

  // --- Bloco 5: assinaturas ---
  posicao = garantirEspaco(posicao + 44, 40);
  const larguraAssinatura = larguraUtil * 0.4;
  const centros = [MARGEM + larguraAssinatura / 2, direita - larguraAssinatura / 2];
  const rotulos = ["Responsável pela elaboração", "Aprovação"];

  doc.setDrawColor(...COR_NAVY);
  doc.setLineWidth(0.8);
  centros.forEach((centro, indice) => {
    doc.line(centro - larguraAssinatura / 2, posicao, centro + larguraAssinatura / 2, posicao);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONTE - 1);
    doc.setTextColor(...COR_CINZA);
    doc.text(rotulos[indice], centro, posicao + 12, { align: "center" });
  });

  // --- Rodapé: numeração exata, depois de o documento estar fechado ---
  const paginas = doc.getNumberOfPages();
  for (let pagina = 1; pagina <= paginas; pagina++) {
    doc.setPage(pagina);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONTE - 1.5);
    doc.setTextColor(...COR_CINZA);
    doc.text(`Página ${pagina} de ${paginas}`, direita, alturaPagina - MARGEM + FONTE, { align: "right" });
  }

  doc.save(entrada?.arquivo || `${nomeArquivoProgramacao(entrada?.dataProgramacao)}.pdf`);
  return true;
}
