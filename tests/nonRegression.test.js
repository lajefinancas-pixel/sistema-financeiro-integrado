import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("backup manual e restauração permanecem disponíveis", async () => {
  const [categoria, biblioteca] = await Promise.all([
    read("src/components/configuracoes/CategoriaBackup.jsx"),
    read("src/lib/backups.js"),
  ]);
  assert.match(categoria, /Gerar Backup Agora/);
  assert.match(categoria, /restaur/i);
  assert.match(biblioteca, /gerarBackupManual/);
});

test("nenhuma função agendada foi criada", async () => {
  const funcoes = await Promise.all([
    read("netlify/functions/account-transfers.mts"),
    read("netlify/functions/supplier-payment-methods.mts"),
  ]);
  for (const codigo of funcoes) assert.doesNotMatch(codigo, /schedule\s*:/);
});

test("migração mantém transferência separada de pagamento", async () => {
  const sql = await read("supabase/migrations/20260825120000_conta_pagamento_transferencias_dados_fornecedor.sql");
  assert.match(sql, /confirmar_transferencias_programacao/);
  assert.match(sql, /chave_idempotencia text not null unique/);
  assert.match(sql, /conta_pagamento_id/);
  assert.match(sql, /estornar_transferencia/);
  assert.doesNotMatch(sql, /insert into public\.pagamentos[\s\S]*transferencias_contas/i);
});

test("tela contém seleção múltipla, conta concentradora e conferência", async () => {
  const pagina = await read("src/pages/Pagamentos.jsx");
  assert.match(pagina, /Selecionar todas/);
  assert.match(pagina, /Buscar conta/);
  assert.match(pagina, /Conta de pagamento/);
  assert.match(pagina, /Valor a transferir/);
  assert.match(pagina, /Confirmar transferências/);
  assert.match(pagina, /Debita integralmente da conta de pagamento/);
  assert.doesNotMatch(pagina, /Ratear automaticamente/);
});

test("fornecedor aceita PIX, conta bancária e forma principal", async () => {
  const painel = await read("src/components/fornecedores/DadosParaPagamento.jsx");
  assert.match(painel, /Adicionar PIX/);
  assert.match(painel, /Adicionar Conta Bancária/);
  assert.match(painel, /Marcar como principal/);
  assert.match(painel, /CPF\/CNPJ do titular/);
});
