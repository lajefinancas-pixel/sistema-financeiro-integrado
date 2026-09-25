import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { regularidadeDoFornecedor } from "../src/lib/regularidadePagamentoRegras.js";

const read = (arquivo) => readFile(new URL(`../${arquivo}`, import.meta.url), "utf8");

test("Bandas, Patrocínios e Aluguéis leem a regularidade do fornecedor na listagem", async () => {
  const [pagina, descritores] = await Promise.all([
    read("src/components/fornecedores/areas/PaginaAreaFornecedores.jsx"),
    read("src/lib/areasFornecedores.js"),
  ]);

  for (const area of ["bandas", "patrocinios", "alugueis"]) {
    assert.match(descritores, new RegExp(`id: ["']${area}["']`));
  }
  assert.match(pagina, /consultarRegularidadesPagamento\(carregados\.map\(\(r\) => r\.fornecedor_id\)\)/);
  assert.match(pagina, /regularidades\[String\(registro\.fornecedor_id\)\]/);
  assert.match(pagina, /regularidade\.documental\.texto/);
  assert.match(pagina, /Dados para pagamento pendentes/);
});

test("a baixa consulta o mesmo fornecedor e exige conferência antes de prosseguir", async () => {
  const modal = await read("src/components/baixas/ModalRegistrarBaixa.jsx");

  assert.match(modal, /consultarRegularidadePagamento\(fornecedorId\)/);
  assert.match(modal, /regularidade\?\.pendente/);
  assert.match(modal, /window\.confirm/);
  assert.match(modal, /consultandoRegularidade \|\| erroRegularidade \|\| !regularidade/);
  assert.match(modal, /disabled=\{salvando \|\| consultandoRegularidade \|\| erroRegularidade/);
});

test("pendências aparecem e somem usando somente certidões e pagamento do cadastro central", () => {
  const pendente = regularidadeDoFornecedor([], []);
  assert.deepEqual(pendente.avisos, ["Sem certidão cadastrada", "Dados para pagamento pendentes"]);
  assert.equal(pendente.pendente, true);

  const vencida = regularidadeDoFornecedor([
    { id: 1, fornecedor_id: 7, tipo_certidao_id: 2, data_emissao: "2026-01-01", data_vencimento: "2026-01-31" },
  ], []);
  assert.deepEqual(vencida.avisos, ["1 certidão vencida", "Dados para pagamento pendentes"]);

  const regularizada = regularidadeDoFornecedor([
    { id: 2, fornecedor_id: 7, tipo_certidao_id: 2, data_emissao: "2026-09-01", data_vencimento: "2099-12-31" },
  ], [{ kind: "bank_account" }]);
  assert.deepEqual(regularizada.avisos, []);
  assert.equal(regularizada.pendente, false);
});

test("áreas não guardam cópias de certidões nem dados bancários", async () => {
  const [migration, dados] = await Promise.all([
    read("supabase/migrations/20260910140000_areas_fornecedores_patrocinios_alugueis_bandas.sql"),
    read("src/lib/areasFornecedoresDados.js"),
  ]);
  const camposDuplicados = /\b(certidoes?|dados_bancarios|banco|agencia|conta_bancaria|chave_pix)\b/i;
  const sqlExecutavel = migration.replace(/^\s*--.*$/gm, "");

  assert.doesNotMatch(sqlExecutavel, camposDuplicados);
  assert.doesNotMatch(dados, /\.(?:insert|update)\([^)]*(?:certid|dados_banc|agencia|chave_pix)/is);
});
