import test from "node:test";
import assert from "node:assert/strict";
import { boletoValido, formatarCodigoBoleto } from "../src/lib/processosFormaPagamento.js";
import { dadosDoDocumento, htmlDoProcesso } from "../src/lib/processosServicosDocumento.js";
import { formularioParaBanco, processoVazio } from "../src/lib/processosServicos.js";

test("boleto aceita os formatos bancários usuais e rejeita código incompleto", () => {
  assert.equal(boletoValido("1".repeat(44)), true);
  assert.equal(boletoValido(formatarCodigoBoleto("1".repeat(47))), true);
  assert.equal(boletoValido("1".repeat(43)), false);
});

test("forma de pagamento e boleto são gravados e impressos sem exigir banco do favorecido", () => {
  const formulario = {
    ...processoVazio({ ano: 2026, hoje: "2026-09-22" }),
    forma_pagamento: "boleto",
    boleto_codigo: "1".repeat(47),
    boleto_beneficiario: "Companhia de Energia",
    boleto_documento: "12.345.678/0001-90",
    boleto_vencimento: "2026-09-30",
    boleto_valor: 321.45,
  };
  const linha = formularioParaBanco(formulario);
  assert.equal(linha.forma_pagamento, "boleto");
  assert.equal(linha.banco, null);
  assert.equal(linha.boleto_valor, 321.45);

  const html = htmlDoProcesso(dadosDoDocumento(formulario), { escopo: "liquidacao" });
  assert.match(html, /Boleto bancário/);
  assert.match(html, /Companhia de Energia/);
  assert.match(html, /30\/09\/2026/);
});

test("processo antigo continua usando dados bancários por padrão", () => {
  const dados = dadosDoDocumento({ banco: "Banco existente", agencia: "123", conta: "456" });
  const html = htmlDoProcesso(dados, { escopo: "liquidacao" });
  assert.match(html, /Banco existente/);
  assert.doesNotMatch(html, /Boleto bancário/);
});
