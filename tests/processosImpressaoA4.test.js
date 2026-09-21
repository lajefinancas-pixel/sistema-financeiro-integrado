import test from "node:test";
import assert from "node:assert/strict";
import {
  dadosDoDocumento as dadosDiaria,
  htmlDoProcesso as htmlDiaria,
  montarPdfDoProcesso as pdfDiaria,
} from "../src/lib/processosDiariasDocumento.js";
import {
  dadosDoDocumento as dadosServico,
  htmlDoProcesso as htmlServico,
  montarPdfDoProcesso as pdfServico,
} from "../src/lib/processosServicosDocumento.js";

const longa = "referencia-sem-espacos-".repeat(30);
const documentos = () => [
  htmlDiaria(dadosDiaria({ objeto: longa })),
  htmlServico(dadosServico({ itens: [{ quantidade: "1", discriminacao: longa }] })),
];

test("documentos de processos usam a área útil A4 e não forçam folha vazia ao final", () => {
  for (const html of documentos()) {
    assert.match(html, /@page \{ size: A4 portrait; margin: 0; \}/);
    assert.match(html, /\.folha \{[^}]*width: 210mm;[^}]*min-height: 297mm/);
    assert.match(html, /\.folha \+ \.folha \{ page-break-before: always; break-before: page; \}/);
    assert.doesNotMatch(html, /\.folha \{[^}]*page-break-after:\s*always/);
  }
});

test("tabelas e células quebram texto longo dentro das bordas", () => {
  for (const html of documentos()) {
    assert.match(html, /table \{[^}]*width: 100%;[^}]*box-sizing: border-box/);
    assert.match(html, /th, td \{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;[^}]*word-break: break-word/);
    assert.doesNotMatch(html, /table-layout:\s*fixed/);
    assert.doesNotMatch(html, /overflow:\s*hidden/);
  }
});

test("PDF preserva integralmente Discriminação e Referência e não cria folhas vazias", () => {
  const textoLongo = "processo administrativo nº 0014/2026, de 23 de novembro de 2026, termo de apoio à Cavalgada dos Municípios";
  const pdf = pdfServico(dadosServico({
    referencia: textoLongo,
    itens: [{ quantidade: "1", discriminacao: textoLongo }],
  }));
  assert.equal(pdf.getNumberOfPages(), 2);
  const conteudo = pdf.internal.pages.slice(1).map((pagina) => pagina.join("\n"));
  for (const trecho of ["administrativo", "nº", "23 de novembro de", "termo de", "Cavalgada dos"]) {
    assert.ok(conteudo.some((pagina) => pagina.includes(trecho)), `trecho ausente: ${trecho}`);
  }
  assert.ok(conteudo.every((pagina) => /\) Tj/.test(pagina)), "nenhuma folha pode estar vazia");

  const diaria = pdfDiaria(dadosDiaria({ objeto: textoLongo, prestacao_relatorio: textoLongo }));
  assert.equal(diaria.getNumberOfPages(), 3);
  assert.ok(diaria.internal.pages.slice(1).every((pagina) => pagina.some((comando) => comando.includes(") Tj"))));
});
