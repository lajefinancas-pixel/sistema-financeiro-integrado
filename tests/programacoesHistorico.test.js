import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { filtrarEOrdenarProgramacoes, programacaoConcluida } from "../src/lib/programacoesHistorico.js";

const PROGRAMACOES = [
  { id: 39, data_programacao: "2026-09-22", secretaria_id: 1, status: "em_elaboracao", fechado: false },
  { id: 41, data_programacao: "2026-09-24", secretaria_id: 2, status: "em_analise", fechado: false },
  { id: 40, data_programacao: "2026-09-23", secretaria_id: 1, status: "aprovada", fechado: true },
  { id: 42, data_programacao: "2026-09-20", secretaria_id: 1, status: "aprovada", fechado: false, concluida: false },
  { id: 43, data_programacao: "2026-09-10", secretaria_id: 1, status: "aprovada", fechado: false, concluida: true },
];

test("histórico começa pela data mais recente e permite ordenar pelo número", () => {
  assert.deepEqual(
    filtrarEOrdenarProgramacoes(PROGRAMACOES, { ordenacao: "data_desc" }).map((item) => item.id),
    [41, 40, 39, 42, 43],
  );
  assert.deepEqual(
    filtrarEOrdenarProgramacoes(PROGRAMACOES, { ordenacao: "numero_asc" }).map((item) => item.id),
    [39, 40, 41, 42, 43],
  );
});

test("período usa limites inclusivos e aceita somente uma das pontas", () => {
  assert.deepEqual(filtrarEOrdenarProgramacoes(PROGRAMACOES, { dataDe: "2026-09-10", dataAte: "2026-09-23" }).map((item) => item.id), [40, 39, 42, 43]);
  assert.deepEqual(filtrarEOrdenarProgramacoes(PROGRAMACOES, { dataDe: "2026-09-23" }).map((item) => item.id), [41, 40]);
  assert.deepEqual(filtrarEOrdenarProgramacoes(PROGRAMACOES, { dataAte: "2026-09-20" }).map((item) => item.id), [42, 43]);
});

test("concluída exige total positivo integralmente marcado como pago", () => {
  assert.equal(programacaoConcluida(150.3, 150.3), true);
  assert.equal(programacaoConcluida(150.3, 100), false);
  assert.equal(programacaoConcluida(0, 0), false);
  assert.deepEqual(filtrarEOrdenarProgramacoes(PROGRAMACOES, { status: "concluida" }).map((item) => item.id), [43]);
  assert.deepEqual(filtrarEOrdenarProgramacoes(PROGRAMACOES, { status: "aprovada" }).map((item) => item.id), [42]);
});

test("buscar pelo número 41 encontra somente a programação correta", () => {
  const resultado = filtrarEOrdenarProgramacoes(PROGRAMACOES, { numero: "41", ordenacao: "data_desc" });
  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].id, 41);
  assert.equal(resultado[0].secretaria_id, 2);
  assert.equal(resultado[0].data_programacao, "2026-09-24");
});

test("filtros distinguem histórico fechado de status ainda ativo", () => {
  assert.deepEqual(
    filtrarEOrdenarProgramacoes(PROGRAMACOES, { status: "historico", ordenacao: "data_desc" }).map((item) => item.id),
    [40],
  );
  assert.deepEqual(
    filtrarEOrdenarProgramacoes(PROGRAMACOES, { status: "aprovada", ordenacao: "data_desc" }).map((item) => item.id),
    [42],
  );
});

test("consulta do histórico é paginada e estritamente de leitura", () => {
  const fonte = fs.readFileSync(new URL("../src/lib/programacoesHistorico.js", import.meta.url), "utf8");
  assert.match(fonte, /\.range\(inicio, inicio \+ TAMANHO_PAGINA - 1\)/);
  assert.match(fonte, /\.from\("programacoes_pagamento"\)/);
  assert.doesNotMatch(fonte, /\.(insert|update|delete|upsert|rpc)\s*\(/);
});

test("a lista abre o registro na tela existente sem executar ação financeira", () => {
  const lista = fs.readFileSync(new URL("../src/components/pagamentos/ListaProgramacoes.jsx", import.meta.url), "utf8");
  const tela = fs.readFileSync(new URL("../src/pages/PagamentosRedesenhado.jsx", import.meta.url), "utf8");
  assert.match(lista, /onAbrir\(item\)/);
  assert.match(tela, /function abrirProgramacaoDaLista\(item\)/);
  assert.match(tela, /setProgramacaoId\(item\.id\)/);
  assert.doesNotMatch(lista, /\.(insert|update|delete|upsert|rpc)\s*\(/);
});
