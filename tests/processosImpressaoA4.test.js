import test from "node:test";
import assert from "node:assert/strict";
import { dadosDoDocumento as dadosDiaria, htmlDoProcesso as htmlDiaria } from "../src/lib/processosDiariasDocumento.js";
import { dadosDoDocumento as dadosServico, htmlDoProcesso as htmlServico } from "../src/lib/processosServicosDocumento.js";

const longa = "referencia-sem-espacos-".repeat(30);
const documentos = () => [
  htmlDiaria(dadosDiaria({ objeto: longa })),
  htmlServico(dadosServico({ itens: [{ quantidade: "1", discriminacao: longa }] })),
];

test("documentos de processos usam a área útil A4 e não forçam folha vazia ao final", () => {
  for (const html of documentos()) {
    assert.match(html, /@page \{ size: A4 portrait; margin: 8mm 10mm 5mm; \}/);
    assert.match(html, /\.folha \{[^}]*width: 100%;[^}]*max-width: 100%/);
    assert.match(html, /\.folha \+ \.folha \{ page-break-before: always; break-before: page; \}/);
    assert.doesNotMatch(html, /\.folha \{[^}]*page-break-after:\s*always/);
  }
});

test("tabelas e células quebram texto longo dentro das bordas", () => {
  for (const html of documentos()) {
    assert.match(html, /table \{[^}]*width: 100%;[^}]*table-layout: fixed;[^}]*box-sizing: border-box/);
    assert.match(html, /th, td \{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;[^}]*word-break: break-word/);
    assert.match(html, /img, svg, canvas, object, embed \{ max-width: 100%; height: auto; object-fit: contain; \}/);
  }
});
