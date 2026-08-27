import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migrationConsolidada = "supabase/migrations/20260827000000_consolidar_fluxo_pagamentos_diarios.sql";

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
  const sql = await read(migrationConsolidada);
  assert.match(sql, /confirmar_transferencias_programacao/);
  assert.match(sql, /chave_idempotencia text not null unique/);
  assert.match(sql, /conta_pagamento_id/);
  assert.match(sql, /estornar_transferencia/);
  assert.doesNotMatch(sql, /insert into public\.pagamentos\s*\(/i);
});

test("tela aplica saldo primeiro, seleção múltipla e concentração opcional", async () => {
  const pagina = await read("src/pages/PagamentosRedesenhado.jsx");
  assert.match(pagina, /carregarSaldosDasContas/);
  assert.match(pagina, /comReservas:\s*false/);
  assert.match(pagina, /Selecionar todas/);
  assert.match(pagina, /Buscar conta, banco ou número/);
  assert.match(pagina, /Contas selecionadas/);
  assert.match(pagina, /Total disponível hoje/);
  assert.match(pagina, /sticky top-0/);
  assert.match(pagina, /Concentrar saldos/);
  assert.match(pagina, /Somente a confirmação movimenta débito e crédito na mesma transação/);
  assert.match(pagina, /Origens da concentração/);
  assert.doesNotMatch(pagina, /conta_pagamento_id/);
  assert.match(pagina, /totalizarSaldos\(contasSelecionadasComSaldo\)\.saldoReal/);
  assert.doesNotMatch(pagina, /saldoHoje/);
});

test("relação aceita parcial, avulso e excesso sem bloqueio", async () => {
  const pagina = await read("src/pages/PagamentosRedesenhado.jsx");
  assert.match(pagina, /Valor em aberto/);
  assert.match(pagina, /Valor a pagar/);
  assert.match(pagina, /Fornecedor não cadastrado/);
  assert.match(pagina, /A proposta excede o disponível/);
  assert.match(pagina, /A edição e a impressão continuam liberadas/);
  assert.doesNotMatch(pagina, /totalPagar\s*>\s*totalDisponivel[\s\S]*return/);
});

test("conta de origem pertence ao pagamento e respeita a secretaria", async () => {
  const [pagina, migration] = await Promise.all([
    read("src/pages/PagamentosRedesenhado.jsx"),
    read(migrationConsolidada),
  ]);
  assert.match(pagina, /definir_conta_origem_pagamento/);
  assert.match(pagina, /conta_origem_id/);
  assert.match(migration, /add column if not exists conta_origem_id integer/);
  assert.match(migration, /Pagamentos só podem usar contas da secretaria da programação/);
  assert.match(migration, /A conta de origem precisa estar selecionada como conta de trabalho/);
  assert.match(migration, /set conta_origem_id = p_conta_id/);
  assert.match(migration, /conta_pagamento_id é preservada sem uso/);
  assert.doesNotMatch(migration, /drop column[^;]+conta_pagamento_id/i);
});

test("impressão da programação é documento próprio, sem elementos de tela", async () => {
  const [pagina, documento] = await Promise.all([
    read("src/pages/PagamentosRedesenhado.jsx"),
    read("src/lib/programacaoDocumento.js"),
  ]);
  // A tela não é mais capturada: a impressão e o PDF saem do documento próprio.
  assert.match(pagina, /imprimirProgramacao/);
  assert.match(pagina, /gerarPdfProgramacao/);
  assert.match(pagina, /registrar_impressao_programacao/);
  assert.doesNotMatch(pagina, /window\.print/);
  assert.doesNotMatch(pagina, /hidden print:block/);
  // Estrutura obrigatória do documento levado ao gestor.
  assert.match(documento, /PROGRAMAÇÃO DE PAGAMENTOS/);
  assert.match(documento, /Contas selecionadas/);
  assert.match(documento, /Total disponível hoje/);
  assert.match(documento, /Relação de fornecedores/);
  assert.match(documento, /VALOR EM ABERTO/);
  assert.match(documento, /VALOR A PAGAR/);
  assert.match(documento, /APROVADO/);
  assert.match(documento, /Diferença/);
  assert.match(documento, /Observações/);
  assert.match(documento, /Responsável pela elaboração/);
  assert.match(documento, /Aprovação/);
  assert.match(documento, /Página \$\{pagina\} de \$\{paginas\}/);
  assert.match(documento, /size: A4 portrait/);
  assert.match(documento, /display: table-header-group/);
  // Nada de interface no papel.
  for (const interface_ of [/<input/, /<select/, /<button/, /checkbox/, /Buscar/, /Todos os bancos/]) {
    assert.doesNotMatch(documento, interface_);
  }
});

test("somente as contas marcadas vão ao documento da programação", async () => {
  const pagina = await read("src/pages/PagamentosRedesenhado.jsx");
  assert.match(pagina, /contas: contasSelecionadasComSaldo\.map/);
  assert.doesNotMatch(pagina, /contas: contasFiltradas/);
});

test("impressões já aprovadas dos outros módulos seguem intocadas", async () => {
  const [saldos, relatorios, certidoes, pagina] = await Promise.all([
    read("src/lib/saldosDocumento.js"),
    read("src/lib/relatoriosDocumento.js"),
    read("src/lib/certidoesDocumento.js"),
    read("src/pages/PagamentosRedesenhado.jsx"),
  ]);
  // Saldos das Contas: ordem fixa das colunas e as três saídas.
  assert.match(saldos, /export const COLUNAS_SALDOS = \["Banco", "Número da Conta", "Saldo", "Nome da Conta"\]/);
  assert.match(saldos, /export function imprimirSaldos/);
  assert.match(saldos, /export function gerarPdfSaldos/);
  // Relatórios (base de Fornecedores, Certidões e demais módulos).
  assert.match(relatorios, /export function imprimirRelatorio/);
  assert.match(relatorios, /export function gerarPdfRelatorio/);
  assert.match(relatorios, /export function exportarExcelRelatorio/);
  assert.match(certidoes, /export function imprimirCertidoes/);
  assert.match(certidoes, /export function gerarPdfCertidoes/);
  assert.match(certidoes, /export function exportarExcelCertidoes/);
  // A Programação Diária não empresta o documento de nenhum outro módulo.
  assert.doesNotMatch(pagina, /saldosDocumento|relatoriosDocumento|certidoesDocumento/);
});

test("seleção não movimenta saldo e pagamento pode ocorrer sem concentração", async () => {
  const pagina = await read("src/pages/PagamentosRedesenhado.jsx");
  assert.match(pagina, /programacao_contas/);
  assert.match(pagina, /Selecionar conta não movimenta saldo/);
  assert.doesNotMatch(pagina, /alternarConta[\s\S]{0,1800}saldos_historico/);
  assert.match(pagina, /Indique de qual conta este pagamento sai/);
  assert.match(pagina, /contaSugeridaId=\{baixaPendente\.conta_origem_id \|\| destinoConcentracao\}/);
});

test("transferência entre secretarias fica restrita à exceção de Finanças", async () => {
  const [pagina, migration] = await Promise.all([
    read("src/pages/PagamentosRedesenhado.jsx"),
    read(migrationConsolidada),
  ]);
  assert.match(pagina, /contas de Saúde, Educação e Social/);
  assert.match(migration, /Transferência entre secretarias permitida somente de Finanças para Saúde, Educação ou Social/);
  assert.match(migration, /cb\.secretaria_id = v_programacao\.secretaria_id/);
  assert.match(migration, /A conta de origem deve estar selecionada e pertencer à secretaria da programação/);
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
