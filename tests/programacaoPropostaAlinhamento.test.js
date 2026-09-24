import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { definirValorProgramado } from "../src/lib/planejamentoPagamentos.js";
import { linhasDaProposta } from "../src/lib/programacaoProposta.js";
import { nomeExibicaoDoPagamento } from "../src/lib/nomesFornecedor.js";

const registrosDaProgramacao41 = [
  [119, 41, "INFINITY (CASA DA CRIANCA)", 102468.88],
  [120, 22, "CTR QUIPAPA", 7472.79],
  [121, 30, "VIVA O VERDE LTDA", 21673.42],
  [122, null, "PRECATORIO", 64524.59],
  [123, null, "CIMENTO VAL", 12000],
  [124, 44, "FABIO MANOEL BITTENCOURT", 33248.65],
  [125, null, "CRISTIANO (ENTRADA)", 16096.5],
  [126, null, "SAÚDE", 20000],
  [127, null, "ASSISTENCIA SOCIAL", 10000],
  [128, null, "WL (PREFEITURA)", 64225.42],
  [129, 37, "ADAUTO RODRIGUES DA SILVA LTDA", 4000],
  [130, null, "SEU FRANCISCO", 7160],
].map(([id, fornecedor_id, nome, valor_a_pagar]) => ({
  id,
  fornecedor_id,
  nome_avulso: fornecedor_id ? null : nome,
  fornecedores: fornecedor_id ? { razao_social: nome } : null,
  valor_a_pagar,
}));

function pares(linhas) {
  return Object.fromEntries(linhas.map(({ pagamento }) => [
    nomeExibicaoDoPagamento(pagamento),
    pagamento.valor_a_pagar,
  ]));
}

test("Proposta mantém os 12 nomes e valores da programação 41 no mesmo registro", () => {
  const linhas = linhasDaProposta(registrosDaProgramacao41);

  assert.deepEqual(
    linhas.map(({ pagamento }) => pagamento.id).sort((a, b) => a - b),
    registrosDaProgramacao41.map((pagamento) => pagamento.id),
  );
  assert.deepEqual(pares(linhas), {
    "ADAUTO RODRIGUES DA SILVA LTDA": 4000,
    "ASSISTENCIA SOCIAL": 10000,
    "CIMENTO VAL": 12000,
    "CRISTIANO (ENTRADA)": 16096.5,
    "CTR QUIPAPA": 7472.79,
    "FABIO MANOEL BITTENCOURT": 33248.65,
    "INFINITY (CASA DA CRIANCA)": 102468.88,
    PRECATORIO: 64524.59,
    "SAÚDE": 20000,
    "SEU FRANCISCO": 7160,
    "VIVA O VERDE LTDA": 21673.42,
    "WL (PREFEITURA)": 64225.42,
  });
});

test("editar e recarregar não desloca o valor para outro fornecedor", () => {
  const cristiano = registrosDaProgramacao41.find((item) => item.id === 125);
  const editados = definirValorProgramado(registrosDaProgramacao41, cristiano, 17000.25);
  const recarregados = editados.map((item) => ({
    ...item,
    fornecedores: item.fornecedores ? { ...item.fornecedores } : null,
  }));

  const exibidos = pares(linhasDaProposta(recarregados));
  assert.equal(exibidos["CRISTIANO (ENTRADA)"], 17000.25);
  assert.equal(exibidos["CTR QUIPAPA"], 7472.79);
  assert.equal(exibidos["FABIO MANOEL BITTENCOURT"], 33248.65);
  assert.equal(exibidos["INFINITY (CASA DA CRIANCA)"], 102468.88);
});

test("a tela renderiza nome e CampoMoeda a partir da mesma linha da Proposta", async () => {
  const pagina = await readFile(new URL("../src/pages/PagamentosRedesenhado.jsx", import.meta.url), "utf8");
  assert.match(pagina, /linhasProposta\.map\(\(\{ pagamento, chave \}, indice\)/);
  assert.match(pagina, /<CampoMoeda valor=\{pagamento\.valor_a_pagar\}/);
  assert.doesNotMatch(pagina, /pagamentosOrdenados\.map\(\(pagamento, indice\).*CampoMoeda/);
});
