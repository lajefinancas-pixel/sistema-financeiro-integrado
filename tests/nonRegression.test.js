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
  assert.match(pagina, /Buscar por nome, banco ou conta/);
  assert.match(pagina, /Conta de pagamento/);
  assert.match(pagina, /tipo="radio"/);
  assert.match(pagina, /tipo="checkbox"/);
  assert.match(pagina, /Todas as secretarias/);
  assert.match(pagina, /WebkitOverflowScrolling/);
  assert.match(pagina, /Valor a transferir/);
  assert.match(pagina, /Confirmar transferências/);
  assert.match(pagina, /Registrar baixa/);
  assert.match(pagina, /permite pagamento parcial/);
  assert.doesNotMatch(pagina, /<select[^>]+value=\{contaPagamentoId\}/);
  assert.doesNotMatch(pagina, /Ratear automaticamente/);
});

test("programações antigas usam campos opcionais sem bloquear pagamentos", async () => {
  const pagina = await read("src/pages/Pagamentos.jsx");
  assert.match(pagina, /select\("id, fechado"\)/);
  assert.match(pagina, /conta_pagamento_id: null/);
  assert.match(pagina, /forma_pagamento_id: null/);
  assert.match(pagina, /setPagamentos\(pgs \?\? \[\]\)/);
  assert.match(pagina, /console\.error\("\[Pagamentos\] Falha ao carregar os dados essenciais/);
});

test("conta de pagamento usa RPC dedicada sem movimentar saldo", async () => {
  const [pagina, migration] = await Promise.all([
    read("src/pages/Pagamentos.jsx"),
    read("supabase/migrations/20260825160000_corrigir_conta_pagamento_programacao.sql"),
  ]);
  assert.match(pagina, /rpc\("definir_conta_pagamento_programacao"/);
  assert.match(pagina, /Erro do Supabase ao definir a conta de pagamento/);
  assert.match(pagina, /setContaPagamentoId\(contaId \?\? ""\)/);
  assert.match(migration, /add column if not exists conta_pagamento_id/);
  assert.match(migration, /update public\.programacoes_pagamento[\s\S]+set conta_pagamento_id = p_conta_id/);
  assert.doesNotMatch(migration, /update public\.saldos_historico|insert into public\.saldos_historico/);
});

test("histórico e relatórios continuam lendo programações sem campos novos", async () => {
  const [historico, relatorios] = await Promise.all([
    read("src/lib/historicoMovimentacoes.js"),
    read("src/lib/relatoriosDados.js"),
  ]);
  assert.doesNotMatch(historico, /conta_pagamento_id|transferencias_contas/);
  assert.doesNotMatch(relatorios, /conta_pagamento_id|transferencias_contas/);
});

test("fornecedor aceita PIX, conta bancária e forma principal", async () => {
  const painel = await read("src/components/fornecedores/DadosParaPagamento.jsx");
  assert.match(painel, /Adicionar PIX/);
  assert.match(painel, /Adicionar Conta Bancária/);
  assert.match(painel, /Marcar como principal/);
  assert.match(painel, /CPF\/CNPJ do titular/);
});
