import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatBRL } from "./moeda.js";
import { imprimirDocumentoHtml } from "./impressaoNavegador.js";
import { COR_IMPRESSAO as COR, TINTA_IMPRESSAO as TINTA } from "./paletaImpressao.js";
import { situacaoContrato } from "./licitacoesContratosRegras.js";

export const MARGEM_DOCUMENTO_LICITACOES = 28;
export const COLUNAS_DOCUMENTO_LICITACOES = ["Fornecedor", "Tipo", "Número", "Objeto", "Assinatura", "Validade", "Valor", "Situação"];

const esc = (valor) => String(valor ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const textoPdf = (valor) => String(valor ?? "").replace(/\u00a0/g, " ");
const dataBR = (iso) => iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—";
const nomeFornecedor = (item) => item.fornecedores?.razao_social || item.fornecedores?.nome_fantasia || "Fornecedor";
const ROTULOS_SITUACAO = { vigente: "Vigente", vencendo: "Vencendo em breve", vencido: "Vencido", encerrado: "Encerrado" };

export function linhasDocumentoLicitacoes(itens = []) {
  return itens.map((item) => [
    nomeFornecedor(item), item.tipos_licitacao_contrato?.nome || "—", item.numero || "—", item.objeto || "—",
    dataBR(item.data_inicio), dataBR(item.data_validade), item.valor == null ? "—" : formatBRL(item.valor),
    ROTULOS_SITUACAO[situacaoContrato(item)] || "—",
  ]);
}

export function montarHtmlLicitacoes(itens = []) {
  const linhas = linhasDocumentoLicitacoes(itens);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Licitações e Contratos</title><style>
    @page { size: A4 landscape; margin: 10mm; } * { box-sizing: border-box; }
    body { margin:0; color:${COR.navy}; font:9px/1.35 Arial,sans-serif; }
    h1 { margin:0 0 3px; font-size:17px; } p { margin:0 0 10px; color:${COR.apoio}; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; } thead { display:table-header-group; }
    tr { break-inside:avoid; page-break-inside:avoid; } th,td { border:1px solid ${COR.linha}; padding:5px; text-align:left; vertical-align:top; overflow-wrap:anywhere; word-break:normal; }
    th { background:${COR.faixa}; font-size:8px; text-transform:uppercase; } .fornecedor{width:16%}.tipo{width:9%}.numero{width:9%}.objeto{width:27%}.data{width:9%}.valor{width:11%}.situacao{width:10%}
  </style></head><body><h1>Licitações e Contratos</h1><p>${linhas.length} registro(s) · Emitido em ${new Date().toLocaleString("pt-BR")}</p><table><colgroup><col class="fornecedor"><col class="tipo"><col class="numero"><col class="objeto"><col class="data"><col class="data"><col class="valor"><col class="situacao"></colgroup><thead><tr>${COLUNAS_DOCUMENTO_LICITACOES.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${linhas.map((linha) => `<tr>${linha.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
}

export function imprimirLicitacoes(itens) { if (itens?.length) imprimirDocumentoHtml(montarHtmlLicitacoes(itens)); }

export function gerarPdfLicitacoes(itens, { salvar = true } = {}) {
  if (!itens?.length) return null;
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const margem = MARGEM_DOCUMENTO_LICITACOES;
  const cabecalho = () => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...TINTA.navy);
    doc.text("Licitações e Contratos", margem, 23);
  };
  autoTable(doc, {
    startY: 32, margin: { top: 32, right: margem, bottom: margem, left: margem },
    head: [COLUNAS_DOCUMENTO_LICITACOES], body: linhasDocumentoLicitacoes(itens).map((l) => l.map(textoPdf)),
    theme: "grid", showHead: "everyPage", rowPageBreak: "avoid",
    styles: { fontSize: 7, cellPadding: 3, overflow: "linebreak", valign: "top", textColor: TINTA.navy, lineColor: TINTA.linha, lineWidth: 0.35 },
    headStyles: { fillColor: TINTA.faixa, textColor: TINTA.navy, fontStyle: "bold" },
    columnStyles: { 3: { cellWidth: "auto" } },
    didDrawPage: cabecalho,
  });
  if (salvar) doc.save("licitacoes-contratos.pdf");
  return doc;
}
