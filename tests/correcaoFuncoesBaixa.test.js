import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ARQUIVO = join(
  process.cwd(),
  "supabase/migrations/20260922120000_corrigir_funcoes_baixa_pagamentos.sql",
);
const sql = readFileSync(ARQUIVO, "utf8");

test("as RPCs de baixa expõem exatamente os nomes enviados pelo frontend", () => {
  assert.match(sql, /create function public\.registrar_baixa_nota\(\s*p_chave_idempotencia text,\s*p_valor_em_aberto_id text,\s*p_valor numeric,\s*p_data_pagamento date,\s*p_conta_id integer,\s*p_observacao text default null\s*\)/i);
  assert.match(sql, /create function public\.estornar_baixa_nota\(\s*p_baixa_id text,\s*p_motivo text\s*\)/i);
  assert.match(sql, /drop function if exists public\.registrar_baixa_nota\(text, text, numeric, date, integer, text\)/i);
  assert.match(sql, /drop function if exists public\.estornar_baixa_nota\(text, text\)/i);
});

test("a implementação não depende dos invólucros ausentes", () => {
  assert.doesNotMatch(sql, /registrar_baixa_nota_validada|estornar_baixa_nota_validada/i);
  assert.match(sql, /public\.pode_em_baixas\('registrar_baixa'\)/i);
  assert.match(sql, /public\.pode_em_baixas\('estornar_baixa'\)/i);
  assert.match(sql, /on conflict \(chave_idempotencia\)[\s\S]*do nothing/i);
  assert.match(sql, /for update/i);
});

test("a baixa usa somente a razão para acionar o trigger de saldo", () => {
  assert.match(sql, /insert into public\.pagamentos_baixas/i);
  assert.match(sql, /set status = 'estornada'/i);
  assert.doesNotMatch(sql, /(insert into|update|delete from) public\.saldos_historico/i);
  assert.doesNotMatch(sql, /(insert into|update|delete from) public\.(programacoes_pagamento|pagamentos)(\s|$)/i);
});

test("a migration reaplica privilégios e recarrega o schema do PostgREST", () => {
  assert.match(sql, /grant execute on function public\.registrar_baixa_nota[\s\S]*to authenticated/i);
  assert.match(sql, /grant execute on function public\.estornar_baixa_nota[\s\S]*to authenticated/i);
  assert.match(sql, /notify pgrst, 'reload schema';/i);
});
