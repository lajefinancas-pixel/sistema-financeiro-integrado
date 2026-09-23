import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { definirValorProgramado } from "../src/lib/planejamentoPagamentos.js";
import { validarFornecedoresDaProgramacao } from "../src/lib/validacaoFornecedoresProgramacao.js";

test("editar valor preserva fornecedor cadastrado e mantém avulso sem vínculo", () => {
  const cadastrado = { id: 124, fornecedor_id: 37, valor_a_pagar: 10, fornecedores: { razao_social: "ADAUTO RODRIGUES DA SILVA LTDA" } };
  const avulso = { id: 125, fornecedor_id: null, nome_avulso: "CRISTIANO (ENTRADA", valor_a_pagar: 20 };
  const depoisCadastrado = definirValorProgramado([cadastrado, avulso], cadastrado, 31.25);
  const depoisAvulso = definirValorProgramado(depoisCadastrado, depoisCadastrado[1], 42.5);

  assert.equal(depoisAvulso[0].fornecedor_id, 37);
  assert.equal(depoisAvulso[1].fornecedor_id, null);
  assert.equal(depoisAvulso[1].nome_avulso, "CRISTIANO (ENTRADA");
});

test("validação não consulta avulso e aceita fornecedor existente", async () => {
  const chamadas = [];
  const cliente = { rpc: async (nome, args) => {
    chamadas.push({ nome, args });
    return { data: "ok", error: null };
  } };
  await validarFornecedoresDaProgramacao(cliente, [
    { fornecedor_id: 37, fornecedores: { razao_social: "ADAUTO RODRIGUES DA SILVA LTDA" } },
    { fornecedor_id: null, nome_avulso: "CRISTIANO (ENTRADA" },
  ]);
  assert.deepEqual(chamadas, [{ nome: "fornecedor_referenciavel", args: { p_fornecedor_id: 37 } }]);
});

test("fornecedor ausente interrompe antes do salvamento e identifica a linha", async () => {
  const cliente = { rpc: async () => ({ data: "ausente", error: null }) };
  await assert.rejects(
    validarFornecedoresDaProgramacao(cliente, [{
      fornecedor_id: 999,
      fornecedores: { razao_social: "Fornecedor removido" },
    }]),
    (erro) => {
      assert.equal(erro.code, "FORNECEDOR_INEXISTENTE");
      assert.match(erro.message, /Fornecedor removido/);
      assert.match(erro.details, /fornecedor_id=999/);
      assert.match(erro.hint, /antes de enviar p_pagamentos/);
      return true;
    },
  );
});

test("banner mantém DETAIL e HINT colapsados e acessíveis na tela", async () => {
  const pagina = await readFile(new URL("../src/pages/PagamentosRedesenhado.jsx", import.meta.url), "utf8");
  assert.match(pagina, /Ver detalhes técnicos/);
  assert.match(pagina, /<details className=/);
  assert.match(pagina, /\["DETAIL", falha\.details\]/);
  assert.match(pagina, /\["HINT", falha\.hint\]/);
  assert.match(pagina, /setDetalhesErro\(detalhesTecnicosDaFalha\(falha\)\)/);
  assert.match(pagina, /setDetalhesErro\(detalhesTecnicosDaFalha\(error\)\)/);
});

test("nome avulso não sofre corte de 19 caracteres no payload", async () => {
  const pagina = await readFile(new URL("../src/pages/PagamentosRedesenhado.jsx", import.meta.url), "utf8");
  assert.match(pagina, /nome_avulso: typeof item\.nome_avulso === "string" \? item\.nome_avulso\.trim\(\) \|\| null : null/);
  assert.doesNotMatch(pagina, /nome_avulso[^\n]*(slice|substring)\([^\n]*19/);
});

