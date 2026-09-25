import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const MIGRATION = "supabase/migrations/20260925210000_travar_saldo_diario_contra_automacoes.sql";

test("a trava global recusa escrita de saldo fora da RPC manual", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  assert.match(sql, /create trigger saldos_historico_bloquear_automacao/i);
  assert.match(sql, /before insert or update or delete on public\.saldos_historico/i);
  assert.match(sql, /current_setting\('app\.escrita_manual_saldo',true\)/i);
  assert.match(sql, /create or replace function public\.registrar_saldos_manuais\(p_linhas jsonb\)/i);
  assert.match(sql, /set_config\('app\.escrita_manual_saldo','permitida',true\)/i);
});

test("baixa e estorno preservam o saldo e continuam usando as rotinas validadas", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  assert.match(sql, /drop trigger if exists pagamentos_baixas_movimentar_saldo/i);
  assert.match(sql, /registrar_baixa_nota_validada\(\$1,\$2,\$3,\$4,\$5,\$6\)/i);
  assert.match(sql, /estornar_baixa_nota_validada\(\$1,\$2\)/i);
  assert.ok((sql.match(/'\{movimentou_saldo\}','false'::jsonb/g) ?? []).length >= 2);
});

test("transferência e estorno registram a razão sem escrever saldos_historico", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const inicio = sql.indexOf("create or replace function public.confirmar_transferencias_programacao");
  const fim = sql.indexOf("revoke all on function public.confirmar_transferencias_programacao", inicio);
  const funcoes = sql.slice(inicio, fim);
  assert.match(funcoes, /insert into public\.transferencias_contas/i);
  assert.match(funcoes, /update public\.transferencias_contas set status='estornada'/i);
  assert.doesNotMatch(funcoes, /(insert into|update|delete from) public\.saldos_historico/i);
  assert.ok((funcoes.match(/'movimentou_saldo',false/g) ?? []).length >= 4);
});

test("o diagnóstico de 25 de setembro é somente leitura e a migration não restaura saldos", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  assert.match(sql, /diagnostico_alteracoes_automaticas_saldo_20260925/i);
  assert.match(sql, /date '2026-09-25'/i);
  assert.doesNotMatch(sql, /335506[.,]98|278335[.,]98|173366[.,]85|75866[.,]85/);
});

test("as três ações manuais existentes usam a porta protegida sem mudar a tela", async () => {
  const lib = await readFile("src/lib/lancamentoSaldos.js", "utf8");
  const tela = await readFile("src/pages/Saldos.jsx", "utf8");
  assert.match(lib, /rpc\("registrar_saldos_manuais"/);
  assert.match(tela, /await lancarSaldos\(linhas\)/);
  assert.match(tela, /await lancarSaldoDaConta\(/);
  assert.match(tela, /Editar saldos/);
});
