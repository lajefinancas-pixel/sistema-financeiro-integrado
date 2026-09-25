import test from "node:test";
import assert from "node:assert/strict";
import {
  FORMA_PAGAMENTO_BOLETO,
  FORMA_PAGAMENTO_PADRAO,
  formaPagamentoPadraoDoFornecedor,
} from "../src/lib/processosFormaPagamento.js";
import { dadosDoDocumento, htmlDoProcesso } from "../src/lib/processosServicosDocumento.js";

test("fornecedor com boleto sugere boleto e fornecedor legado mantém dados bancários/PIX", () => {
  assert.equal(formaPagamentoPadraoDoFornecedor({ forma_pagamento_padrao: "boleto" }), FORMA_PAGAMENTO_BOLETO);
  assert.equal(formaPagamentoPadraoDoFornecedor({}), FORMA_PAGAMENTO_PADRAO);
  assert.equal(formaPagamentoPadraoDoFornecedor(null), FORMA_PAGAMENTO_PADRAO);
});

test("PDF da Liquidação imprime o quadro correspondente à sugestão escolhida", () => {
  const boleto = htmlDoProcesso(dadosDoDocumento({
    forma_pagamento: formaPagamentoPadraoDoFornecedor({ forma_pagamento_padrao: "boleto" }),
    favorecido_nome: "Companhia de Energia",
    favorecido_cpf_cnpj: "12.345.678/0001-90",
    valor_total: 187.42,
  }), { escopo: "liquidacao" });
  assert.match(boleto, /Boleto bancário/);

  const bancario = htmlDoProcesso(dadosDoDocumento({
    forma_pagamento: formaPagamentoPadraoDoFornecedor({}),
    banco: "Banco Municipal",
    agencia: "1234",
    conta: "56789-0",
  }), { escopo: "liquidacao" });
  assert.match(bancario, /Banco Municipal/);
  assert.doesNotMatch(bancario, /Boleto bancário/);
});
