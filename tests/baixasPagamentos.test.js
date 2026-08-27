import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resumoBaixas, situacaoPagamento, validarValorBaixa } from "../src/lib/regrasBaixas.js";

const read = (arquivo) => readFile(new URL(`../${arquivo}`, import.meta.url), "utf8");
const migrationConsolidada = "supabase/migrations/20260827000000_consolidar_fluxo_pagamentos_diarios.sql";

test("baixa parcial evolui de em aberto até pago", () => {
  assert.equal(situacaoPagamento(50000, 0), "em_aberto");
  assert.equal(situacaoPagamento(50000, 20000), "parcialmente_pago");
  assert.equal(situacaoPagamento(50000, 50000), "pago");
  assert.deepEqual(resumoBaixas(50000, [
    { valor_pago: 20000, status: "efetivada" },
    { valor_pago: 15000, status: "efetivada" },
    { valor_pago: 5000, status: "estornada" },
  ]), { valorTotal: 50000, totalBaixado: 35000, saldoEmAberto: 15000, situacao: "parcialmente_pago" });
});

test("bloqueia baixa superior ao saldo em aberto", () => {
  assert.equal(validarValorBaixa(15000, 15000).ok, true);
  assert.equal(validarValorBaixa(15000.01, 15000).ok, false);
  assert.match(validarValorBaixa(0, 15000).mensagem, /maior que zero/);
});

test("migration registra baixa e débito atomicamente com idempotência", async () => {
  const sql = await read(migrationConsolidada);
  assert.match(sql, /create table if not exists public\.pagamentos_baixas/);
  assert.match(sql, /chave_idempotencia text not null unique/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_chave_idempotencia/);
  assert.match(sql, /insert into public\.pagamentos_baixas[\s\S]+insert into public\.saldos_historico/);
  assert.match(sql, /O valor informado supera o saldo em aberto disponível/);
  assert.match(sql, /p_data_pagamento > current_date/);
});

test("estorno preserva original, devolve saldo e audita os dois eventos", async () => {
  const sql = await read(migrationConsolidada);
  assert.doesNotMatch(sql, /delete from public\.pagamentos_baixas/);
  assert.match(sql, /set status='estornada'/);
  assert.match(sql, /v_saldo\+v_baixa\.valor_pago/);
  assert.match(sql, /'registrou_baixa'/);
  assert.match(sql, /'estornou_baixa'/);
});

test("permissões de baixa são independentes e relatórios incluem filtros", async () => {
  const [permissoes, relatorios, pagina] = await Promise.all([
    read("src/lib/permissoesEspeciais.js"),
    read("src/lib/relatoriosPersonalizados.js"),
    read("src/pages/Baixas.jsx"),
  ]);
  for (const acao of ["visualizar_baixas", "registrar_baixa", "registrar_baixa_avulsa", "editar_baixa", "estornar_baixa"]) assert.match(permissoes, new RegExp(acao));
  assert.match(relatorios, /id: "baixas"/);
  assert.match(relatorios, /campo: "fornecedor"/);
  assert.match(relatorios, /campo: "conta"/);
  assert.match(pagina, /exportarExcel/);
  assert.match(pagina, /exportarPDF/);
  assert.match(pagina, /imprimir/);
});
