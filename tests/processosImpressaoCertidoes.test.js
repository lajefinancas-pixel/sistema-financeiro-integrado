import test from "node:test";
import assert from "node:assert/strict";
import { dadosDoDocumento, montarPdfDoProcesso } from "../src/lib/processosServicosDocumento.js";
import { quantidadeUnidadeValida, validarRascunho } from "../src/lib/processosServicos.js";

test("processo 0005/2026 fica em duas páginas e imprime somente um prefixo de moeda", () => {
  const dados = dadosDoDocumento({
    numero: 5,
    ano: 2026,
    valor_total: 5454,
    itens: [
      { quantidade: "12 UN", discriminacao: "Material de expediente para atendimento administrativo" },
      { quantidade: "4 CX", discriminacao: "Papel para os setores requisitantes" },
      { quantidade: "2 UN", discriminacao: "Suprimentos de impressão" },
      { quantidade: "1 UN", discriminacao: "Serviço de apoio e entrega" },
    ],
  });
  assert.equal(dados.valor.algarismo, "5.454,00");
  const pdf = montarPdfDoProcesso(dados);
  assert.equal(pdf.getNumberOfPages(), 2);
});

test("quantidade e unidade recusam caractere solto no meio", () => {
  assert.equal(quantidadeUnidadeValida("01uUN"), false);
  assert.equal(quantidadeUnidadeValida("01 UN"), true);
  assert.equal(quantidadeUnidadeValida("2,5 KG"), true);
  assert.match(validarRascunho({ solicitante_id: "1", itens: [{ quantidade: "01uUN", discriminacao: "Item" }] }).itens, /Corrija/);
});
