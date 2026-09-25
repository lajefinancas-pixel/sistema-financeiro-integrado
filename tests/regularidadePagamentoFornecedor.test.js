import test from "node:test";
import assert from "node:assert/strict";
import { regularidadeDoFornecedor } from "../src/lib/regularidadePagamentoRegras.js";

test("avisa quando o fornecedor não tem certidão nem dados para pagamento", () => {
  const resultado = regularidadeDoFornecedor([], []);
  assert.equal(resultado.pendente, true);
  assert.deepEqual(resultado.avisos, ["Sem certidão cadastrada", "Dados para pagamento pendentes"]);
});

test("avisa sobre a certidão vigente vencida", () => {
  const resultado = regularidadeDoFornecedor([
    { id: 1, fornecedor_id: 10, tipo_certidao_id: 3, data_emissao: "2025-01-01", data_vencimento: "2025-02-01" },
  ], true);
  assert.equal(resultado.pendente, true);
  assert.equal(resultado.documental.tom, "vencida");
  assert.deepEqual(resultado.avisos, ["1 certidão vencida"]);
});

test("some com os avisos após regularizar certidão e dados para pagamento", () => {
  const futuro = new Date();
  futuro.setUTCFullYear(futuro.getUTCFullYear() + 2);
  const resultado = regularidadeDoFornecedor([
    { id: 2, fornecedor_id: 10, tipo_certidao_id: 3, data_emissao: "2026-01-01", data_vencimento: futuro.toISOString().slice(0, 10) },
  ], [{ kind: "pix" }]);
  assert.equal(resultado.pendente, false);
  assert.equal(resultado.documental.tom, "regular");
  assert.deepEqual(resultado.avisos, []);
});
