import test from "node:test";
import assert from "node:assert/strict";
import { secretariasAtivas, somenteFinanceiras } from "../src/lib/secretariasRegras.js";

const secretarias = [
  { id: 1, nome: "Finanças", ativo: true, possui_financeiro: true },
  { id: 2, nome: "Saúde", ativo: true, possui_financeiro: true },
  { id: 3, nome: "Educação", ativo: true, possui_financeiro: true },
  { id: 4, nome: "Assistência Social", ativo: true, possui_financeiro: true },
  { id: 5, nome: "Cultura e Turismo", ativo: true, possui_financeiro: false },
  { id: 6, nome: "Antiga", ativo: false, possui_financeiro: true },
];

test("Saldos recebe somente as quatro secretarias financeiras ativas", () => {
  assert.deepEqual(somenteFinanceiras(secretarias).map((s) => s.id), [1, 2, 3, 4]);
});

test("cadastros gerais recebem todas as secretarias ativas", () => {
  assert.deepEqual(secretariasAtivas(secretarias).map((s) => s.id), [1, 2, 3, 4, 5]);
});
