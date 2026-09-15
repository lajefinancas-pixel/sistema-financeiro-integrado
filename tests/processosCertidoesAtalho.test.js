import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { somenteVigentes } from "../src/lib/certidoesRegras.js";

const modal = await readFile(new URL("../src/components/processos/ModalProcessoServico.jsx", import.meta.url), "utf8");
const modulo = await readFile(new URL("../src/pages/ModuloProcessos.jsx", import.meta.url), "utf8");

test("processo usa a emissão mais recente de cada tipo e mantém documento sem vencimento", () => {
  const lista = somenteVigentes([
    { id: "antiga", fornecedor_id: "f1", tipo_certidao_id: "fgts", data_vencimento: "2026-09-01", data_emissao: "2026-08-01" },
    { id: "nova", fornecedor_id: "f1", tipo_certidao_id: "fgts", data_vencimento: "2026-10-01", data_emissao: "2026-09-01" },
    { id: "cnpj", fornecedor_id: "f1", tipo_certidao_id: "cnpj", data_vencimento: null, data_emissao: "2026-09-01" },
  ]);
  assert.deepEqual(lista.map((item) => item.id), ["nova", "cnpj"]);
});

test("atalho oferece consulta, downloads separados e alerta antes da finalização", () => {
  assert.match(modal, /titulo="Certidões do fornecedor"/);
  assert.match(modal, /urlDeDownload\(item\.arquivo_url\)/);
  assert.match(modal, /Baixar certidões/);
  assert.match(modal, /window\.confirm\(`Atenção: o fornecedor tem certidão vencida/);
  assert.match(modal, /Nenhuma certidão cadastrada para este fornecedor/);
});

test("seção respeita a permissão de visualização do módulo Certidões", () => {
  assert.match(modulo, /permissaoCertidoes\?\.pode_visualizar === true/);
  assert.match(modal, /podeVisualizarCertidoes && formulario\.fornecedor_id/);
});
