import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatBRL } from "./moeda";

function escapar(valor) {
  return String(valor ?? "").replace(/[&<>'"]/g, (caractere) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[caractere]));
}

function linhasObservacoes(quantidade = 5) {
  return Array.from({ length: quantidade }, () => '<div class="linha-observacao"></div>').join("");
}

export function htmlProgramacao(dados) {
  const contas = dados.contas.map((conta) => `<tr><td>${escapar(conta.banco)}</td><td>${escapar(conta.conta)}</td><td class="valor">${formatBRL(conta.saldo)}</td><td>${escapar(conta.nome)}</td></tr>`).join("");
  const pagamentos = dados.pagamentos.map((pagamento) => `<tr><td>${escapar(pagamento.fornecedor)}</td><td class="valor">${formatBRL(pagamento.valor)}</td></tr>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(dados.titulo)}</title><style>
    @page { size: A4 portrait; margin: 11mm 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #202522; font-family: Georgia, 'Times New Roman', serif; font-size: 10.5pt; }
    header { border-bottom: 2px solid #263f36; padding-bottom: 5mm; margin-bottom: 5mm; }
    h1 { margin: 0; font-size: 16pt; letter-spacing: .04em; text-align: center; }
    .meta { display: flex; justify-content: space-between; gap: 8mm; margin-top: 3mm; font-family: Arial, sans-serif; font-size: 8.5pt; }
    section { margin-top: 5mm; break-inside: avoid-page; }
    h2 { margin: 0 0 2mm; color: #263f36; font-family: Arial, sans-serif; font-size: 9pt; letter-spacing: .09em; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 8.5pt; }
    thead { display: table-header-group; }
    th { background: #e9ece8; color: #263f36; font-size: 7.5pt; letter-spacing: .05em; text-align: left; text-transform: uppercase; }
    th, td { border: 1px solid #aeb7b1; padding: 2.1mm 2.4mm; vertical-align: middle; }
    .pagamentos td { padding-top: 2.8mm; padding-bottom: 2.8mm; }
    .valor { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .total { display: flex; justify-content: flex-end; gap: 8mm; border: 1px solid #aeb7b1; border-top: 0; padding: 2.3mm; font-family: Arial, sans-serif; font-size: 9pt; }
    .resumo { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #aeb7b1; border-top: 0; font-family: Arial, sans-serif; }
    .resumo div { padding: 2.5mm; }
    .resumo div + div { border-left: 1px solid #aeb7b1; }
    .resumo span { display: block; color: #566159; font-size: 7.5pt; text-transform: uppercase; }
    .resumo strong { display: block; margin-top: 1mm; font-size: 11pt; }
    .observacoes { margin-top: 6mm; }
    .linha-observacao { height: 8mm; border-bottom: 1px solid #89948d; }
    footer { margin-top: 5mm; text-align: right; color: #657068; font-family: Arial, sans-serif; font-size: 7.5pt; }
  </style></head><body>
    <header><h1>PROGRAMAÇÃO DIÁRIA DE PAGAMENTOS</h1><div class="meta"><span>Data: <strong>${escapar(dados.data)}</strong></span><span>Responsável: <strong>${escapar(dados.responsavel)}</strong></span></div></header>
    <section><h2>Contas utilizadas</h2><table><thead><tr><th>Banco</th><th>Conta</th><th class="valor">Saldo</th><th>Nome da conta</th></tr></thead><tbody>${contas || '<tr><td colspan="4">Nenhuma conta selecionada.</td></tr>'}</tbody></table><div class="total"><strong>TOTAL DAS CONTAS:</strong><strong>${formatBRL(dados.totalContas)}</strong></div></section>
    <section><h2>Pagamentos propostos</h2><table class="pagamentos"><thead><tr><th>Fornecedor</th><th class="valor">Valor</th></tr></thead><tbody>${pagamentos || '<tr><td colspan="2">Nenhum pagamento proposto.</td></tr>'}</tbody></table><div class="resumo"><div><span>Total programado</span><strong>${formatBRL(dados.totalProgramado)}</strong></div><div><span>Saldo restante</span><strong>${formatBRL(dados.restante)}</strong></div></div></section>
    <section class="observacoes"><h2>Observações / alterações</h2>${linhasObservacoes()}</section>
    <footer>Documento para análise — esta programação não representa pagamento, reserva ou movimentação financeira.</footer>
  </body></html>`;
}

export function imprimirProgramacao(dados) {
  const janela = window.open("", "_blank", "noopener,noreferrer");
  if (!janela) throw new Error("Permita pop-ups para imprimir a programação.");
  janela.document.open();
  janela.document.write(htmlProgramacao(dados));
  janela.document.close();
  janela.addEventListener("load", () => {
    janela.focus();
    janela.print();
  }, { once: true });
}

export function gerarPdfProgramacao(dados) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const largura = pdf.internal.pageSize.getWidth();
  const margem = 13;
  pdf.setTextColor(38, 63, 54);
  pdf.setFont("times", "bold");
  pdf.setFontSize(16);
  pdf.text("PROGRAMAÇÃO DIÁRIA DE PAGAMENTOS", largura / 2, 17, { align: "center" });
  pdf.setDrawColor(38, 63, 54);
  pdf.setLineWidth(0.6);
  pdf.line(margem, 21, largura - margem, 21);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.setTextColor(45, 52, 48);
  pdf.text(`Data: ${dados.data}`, margem, 27);
  pdf.text(`Responsável: ${dados.responsavel}`, largura - margem, 27, { align: "right" });

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(38, 63, 54);
  pdf.text("CONTAS UTILIZADAS", margem, 35);
  autoTable(pdf, {
    startY: 38,
    margin: { left: margem, right: margem },
    head: [["Banco", "Conta", "Saldo", "Nome da conta"]],
    body: dados.contas.length ? dados.contas.map((conta) => [conta.banco, conta.conta, formatBRL(conta.saldo), conta.nome]) : [["Nenhuma conta selecionada", "", "", ""]],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: 1.8, textColor: [32, 37, 34], lineColor: [174, 183, 177], lineWidth: 0.2 },
    headStyles: { fillColor: [233, 236, 232], textColor: [38, 63, 54], fontStyle: "bold" },
    columnStyles: { 2: { halign: "right" } },
  });
  let y = pdf.lastAutoTable.finalY + 5;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(32, 37, 34);
  pdf.text(`TOTAL DAS CONTAS: ${formatBRL(dados.totalContas)}`, largura - margem, y, { align: "right" });
  y += 9;
  pdf.setTextColor(38, 63, 54);
  pdf.text("PAGAMENTOS PROPOSTOS", margem, y);
  autoTable(pdf, {
    startY: y + 3,
    margin: { left: margem, right: margem },
    head: [["Fornecedor", "Valor"]],
    body: dados.pagamentos.length ? dados.pagamentos.map((pagamento) => [pagamento.fornecedor, formatBRL(pagamento.valor)]) : [["Nenhum pagamento proposto", ""]],
    theme: "grid",
    rowPageBreak: "avoid",
    styles: { font: "helvetica", fontSize: 8, cellPadding: 2.5, textColor: [32, 37, 34], lineColor: [174, 183, 177], lineWidth: 0.2 },
    headStyles: { fillColor: [233, 236, 232], textColor: [38, 63, 54], fontStyle: "bold" },
    columnStyles: { 1: { halign: "right", cellWidth: 45 } },
  });
  y = pdf.lastAutoTable.finalY + 5;
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(32, 37, 34);
  pdf.text(`TOTAL PROGRAMADO: ${formatBRL(dados.totalProgramado)}`, margem, y);
  pdf.text(`SALDO RESTANTE: ${formatBRL(dados.restante)}`, largura - margem, y, { align: "right" });
  y += 10;
  if (y > 235) {
    pdf.addPage();
    y = 18;
  }
  pdf.setTextColor(38, 63, 54);
  pdf.text("OBSERVAÇÕES / ALTERAÇÕES", margem, y);
  pdf.setDrawColor(137, 148, 141);
  for (let indice = 1; indice <= 5; indice += 1) pdf.line(margem, y + indice * 8, largura - margem, y + indice * 8);

  const paginas = pdf.getNumberOfPages();
  for (let pagina = 1; pagina <= paginas; pagina += 1) {
    pdf.setPage(pagina);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(101, 112, 104);
    pdf.text(`Página ${pagina} de ${paginas}`, largura - margem, 290, { align: "right" });
  }
  pdf.save(`programacao-diaria-${dados.data.replaceAll("/", "-")}.pdf`);
}
