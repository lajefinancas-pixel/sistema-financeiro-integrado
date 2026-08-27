import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { alternarSelecao, calcularRestante, definirValorProgramado, selecionarTodosVisiveis, somarContasSelecionadas, somarPagamentos } from "../src/lib/planejamentoPagamentos.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migrationPlanejamento = "supabase/migrations/20260827000000_consolidar_fluxo_pagamentos_diarios.sql";

test("seleciona três contas e recalcula o somatório imediatamente", () => {
  const contas = [{ id: 1, saldo: 100000 }, { id: 2, saldo: 250000 }, { id: 3, saldo: 350000 }];
  let selecionadas = new Set();
  selecionadas = alternarSelecao(selecionadas, 1);
  selecionadas = alternarSelecao(selecionadas, 2);
  selecionadas = alternarSelecao(selecionadas, 3);
  assert.equal(somarContasSelecionadas(contas, selecionadas), 700000);
  selecionadas = alternarSelecao(selecionadas, 2);
  assert.equal(somarContasSelecionadas(contas, selecionadas), 450000);
});

test("selecionar todas marca e desmarca as contas visíveis", () => {
  const ids = [1, 2, 3];
  const marcadas = selecionarTodosVisiveis(new Set(), ids);
  assert.deepEqual([...marcadas], ids);
  assert.equal(selecionarTodosVisiveis(marcadas, ids).size, 0);
});

test("valor parcial informado pelo usuário não volta ao saldo do fornecedor", () => {
  const pagamento = { fornecedor_id: 7, valor_a_pagar: 100000 };
  const atualizados = definirValorProgramado([pagamento], pagamento, 30000);
  assert.equal(atualizados[0].valor_a_pagar, 30000);
  assert.equal(somarPagamentos(atualizados), 30000);
});

test("planejamento acima do saldo produz restante negativo sem bloqueio", () => {
  assert.equal(calcularRestante(100000, 125000), -25000);
});

test("tela usa saldos compartilhados, seleção múltipla e resumo fixo", async () => {
  const pagina = await read("src/pages/PagamentosRedesenhado.jsx");
  assert.match(pagina, /carregarSaldosDasContas/);
  assert.match(pagina, /comReservas:\s*false/);
  assert.match(pagina, /Selecionar todas/);
  assert.match(pagina, /sticky top-0/);
  assert.match(pagina, /SALDO TOTAL DA PROGRAMAÇÃO/);
  assert.match(pagina, /PROGRAMAÇÃO ACIMA DO SALDO DISPONÍVEL/);
  assert.match(pagina, /Cadastrar posteriormente como fornecedor/);
  assert.match(pagina, /Marcar em análise/);
  assert.doesNotMatch(pagina, /ModalBaixaPagamento|confirmarTransferencias|Concentrar saldos|Efetuar pagamento|Fechar após efetivação/);
});

test("salvar e reabrir preserva contas, valores e fornecedor avulso", async () => {
  const [pagina, sql] = await Promise.all([read("src/pages/PagamentosRedesenhado.jsx"), read(migrationPlanejamento)]);
  assert.match(pagina, /salvar_planejamento_programacao/);
  assert.match(pagina, /saldo_considerado/);
  assert.match(pagina, /cadastrar_fornecedor_posteriormente/);
  assert.match(sql, /create or replace function public\.salvar_planejamento_programacao/);
  assert.match(sql, /set ativa = false/);
  assert.match(sql, /excluido_em = now\(\)/);
  assert.match(sql, /excluido_em = null/);
});

test("migration é única, idempotente e não movimenta dinheiro", async () => {
  const sql = await read(migrationPlanejamento);
  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /add column if not exists status/);
  assert.match(sql, /create index if not exists/);
  assert.match(sql, /create or replace function/);
  assert.doesNotMatch(sql, /\bdelete\b|drop table|truncate/i);
  assert.doesNotMatch(sql, /insert into public\.saldos_historico|update public\.saldos_historico/i);
  assert.doesNotMatch(sql, /transferencias_contas|pagamentos_baixas|marcar_pagamento_pago/i);
});

test("migration valida todos os tipos confirmados antes do DDL", async () => {
  const sql = await read(migrationPlanejamento);
  const validacao = sql.slice(0, sql.indexOf("alter table"));
  for (const trecho of [
    "('contas_bancarias', 'id', 'integer')",
    "('fornecedores', 'id', 'integer')",
    "('usuarios', 'id', 'uuid')",
    "('programacoes_pagamento', 'conta_pagamento_id', 'integer')",
    "('programacao_contas', 'id', 'integer')",
    "('pagamentos', 'id', 'integer')",
    "('pagamento_movimentacoes', 'id', 'uuid')",
    "('saldos_historico', 'id', 'bigint')",
  ]) assert.match(validacao, new RegExp(trecho.replace(/[()]/g, "\\$&")));
  assert.doesNotMatch(sql, /%rowtype\s*,/i);
});

test("impressão e PDF usam documento próprio sem controles de interface", async () => {
  const [pagina, documento] = await Promise.all([
    read("src/pages/PagamentosRedesenhado.jsx"),
    read("src/lib/programacaoDocumento.js"),
  ]);
  assert.match(pagina, /imprimirProgramacao/);
  assert.match(pagina, /gerarPdfProgramacao/);
  for (const texto of ["PROGRAMAÇÃO DIÁRIA DE PAGAMENTOS", "Contas utilizadas", "Pagamentos propostos", "Observações / alterações", "TOTAL DAS CONTAS", "TOTAL PROGRAMADO", "SALDO RESTANTE"]) assert.match(documento, new RegExp(texto, "i"));
  assert.match(documento, /size: A4 portrait/);
  assert.match(documento, /display: table-header-group/);
  for (const controle of [/<input/, /<select/, /<button/, /checkbox/, /Buscar fornecedor/, /menu lateral/i]) assert.doesNotMatch(documento, controle);
});

test("somente contas selecionadas e valores propostos chegam ao documento", async () => {
  const pagina = await read("src/pages/PagamentosRedesenhado.jsx");
  assert.match(pagina, /contas: contasSelecionadasComSaldo\.map/);
  assert.match(pagina, /pagamentos: pagamentos\.map/);
  assert.doesNotMatch(pagina, /numero_nota_fiscal|retenções|dados bancários/);
});

test("backup manual e impressões dos outros módulos permanecem intactos", async () => {
  const [categoria, biblioteca, saldos, relatorios, certidoes] = await Promise.all([
    read("src/components/configuracoes/CategoriaBackup.jsx"),
    read("src/lib/backups.js"),
    read("src/lib/saldosDocumento.js"),
    read("src/lib/relatoriosDocumento.js"),
    read("src/lib/certidoesDocumento.js"),
  ]);
  assert.match(categoria, /Gerar Backup Agora/);
  assert.match(categoria, /restaur/i);
  assert.match(biblioteca, /gerarBackupManual/);
  assert.match(saldos, /export const COLUNAS_SALDOS = \["Banco", "Número da Conta", "Saldo", "Nome da Conta"\]/);
  assert.match(relatorios, /export function gerarPdfRelatorio/);
  assert.match(certidoes, /export function gerarPdfCertidoes/);
});

test("nenhuma função agendada foi criada", async () => {
  const arquivos = await Promise.all([
    read("netlify/functions/account-transfers.mts"),
    read("netlify/functions/supplier-payment-methods.mts"),
    read(migrationPlanejamento),
  ]);
  for (const codigo of arquivos) assert.doesNotMatch(codigo, /schedule\s*:|cron\s*\(/i);
});
