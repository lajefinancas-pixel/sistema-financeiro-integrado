import test from "node:test";
import assert from "node:assert/strict";
import { situacaoContrato } from "../src/lib/licitacoesContratosRegras.js";

function isoEm(dias) {
  const data = new Date(); data.setHours(12, 0, 0, 0); data.setDate(data.getDate() + dias);
  return data.toISOString().slice(0, 10);
}

test("contrato com validade em 20 dias aparece como Vencendo em breve", () => {
  assert.equal(situacaoContrato({ data_validade: isoEm(20), encerrado: false }), "vencendo");
});

test("contrato com validade passada aparece como Vencido", () => {
  assert.equal(situacaoContrato({ data_validade: isoEm(-1), encerrado: false }), "vencido");
});

test("encerramento manual prevalece sobre a validade", () => {
  assert.equal(situacaoContrato({ data_validade: isoEm(20), encerrado: true }), "encerrado");
});
