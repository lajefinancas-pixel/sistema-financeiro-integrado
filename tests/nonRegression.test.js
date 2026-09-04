import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { alternarSelecao, calcularRestante, definirValorProgramado, ordenarFornecedoresPorAberto, selecionarTodosVisiveis, somarContasSelecionadas, somarPagamentos } from "../src/lib/planejamentoPagamentos.js";
import { classificarFalhaFase1, verificarEstruturaFase1 } from "../src/lib/estruturaPagamentosFase1.js";

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
  assert.match(pagina, /SALDO (?:TOTAL )?DA PROGRAMAÇÃO/);
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

test("fase 1 usa ids inteiros, data selecionada e payload mínimo na criação", async () => {
  const pagina = await read("src/pages/PagamentosRedesenhado.jsx");
  assert.match(pagina, /secretaria_id: secretariaIdInteiro/);
  assert.match(pagina, /data_programacao: data/);
  assert.match(pagina, /responsavel_id: auth\.user\.id/);
  assert.match(pagina, /nome_programacao: nomeAutomatico\(data\)/);
  assert.match(pagina, /p_programacao_id: programacaoIdInteiro/);
  assert.match(pagina, /conta_id: idInteiro\(conta\.id/);
  // Fornecedor avulso continua indo com fornecedor_id nulo. A conferência passou
  // a cobrir também "" e 0, que não são id e faziam o banco recusar o vínculo.
  assert.match(pagina, /fornecedor_id: vazio\(item\.fornecedor_id\) \? null : idInteiro/);
  assert.match(pagina, /function vazio\(valor\) \{\n\s*return valor == null \|\| valor === "" \|\| Number\(valor\) === 0;/);
  assert.doesNotMatch(pagina, /data_programacao: hojeISO\(\)/);
});

test("falhas da fase 1 registram o erro real do Supabase com contexto", async () => {
  const pagina = await read("src/pages/PagamentosRedesenhado.jsx");
  assert.match(pagina, /console\.error\(`\[Pagamentos Fase 1\] \$\{operacao\}`/);
  assert.match(pagina, /Falha ao carregar programações/);
  assert.match(pagina, /Falha ao criar programação/);
  assert.match(pagina, /code: falha\?\.code/);
  assert.match(pagina, /details: falha\?\.details/);
  assert.match(pagina, /hint: falha\?\.hint/);
});

test("falhas de schema da fase 1 indicam as migrations e o banco correto", async () => {
  const [pagina, lib] = await Promise.all([
    read("src/pages/PagamentosRedesenhado.jsx"),
    read("src/lib/estruturaPagamentosFase1.js"),
  ]);
  assert.match(pagina, /20260827000000_consolidar_fluxo_pagamentos_diarios\.sql/);
  assert.match(pagina, /20260827130000_reaplicar_estrutura_pagamentos_fase_1\.sql/);
  assert.match(pagina, /no mesmo projeto Supabase usado pela aplicação/);
  for (const codigo of ["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"]) {
    assert.match(lib, new RegExp(codigo));
  }
  assert.doesNotMatch(pagina, /Rode a migration informada no resumo se necessário/);
  // A decisão nunca volta a sair de palavra solta na mensagem do erro.
  assert.doesNotMatch(pagina, /\\b\(status\|saldo_considerado\|ativa/);
  assert.match(pagina, /Falta no banco/);
});

test("classificação da fase 1 separa estrutura ausente de permissão e de erro comum", () => {
  const coluna = classificarFalhaFase1({ code: "42703", message: "column programacoes_pagamento.status does not exist" });
  assert.equal(coluna.tipo, "estrutura");
  assert.equal(coluna.alvo, "coluna");
  assert.equal(coluna.objeto, "programacoes_pagamento.status");

  const funcao = classificarFalhaFase1({
    code: "PGRST202",
    message: "Could not find the function public.salvar_planejamento_programacao(p_contas) in the schema cache",
  });
  assert.equal(funcao.tipo, "estrutura");
  assert.equal(funcao.alvo, "funcao");
  assert.match(funcao.objeto, /salvar_planejamento_programacao/);

  // RLS e sessão nunca podem virar "estrutura ausente".
  assert.equal(classificarFalhaFase1({ code: "42501", message: "permission denied for table programacoes_pagamento" }).tipo, "permissao");
  assert.equal(classificarFalhaFase1({ code: "PGRST301", message: "JWT expired" }).tipo, "permissao");

  // Erro comum que só cita a palavra "status" ou "ativa" também não vira.
  assert.equal(classificarFalhaFase1({ code: "23514", message: 'new row violates check constraint "status_valido"' }).tipo, "outro");
  assert.equal(classificarFalhaFase1({ code: "PGRST116", message: "The result contains 0 rows" }).tipo, "outro");
});

test("verificação de estrutura só acusa falta quando o banco nega a coluna", async () => {
  const respostas = {
    "programacoes_pagamento:status,saldo_considerado,total_programado,restante,updated_at,ultima_impressao_em": { code: "42703", message: "column programacoes_pagamento.status does not exist" },
    "programacoes_pagamento:status": { code: "42703", message: "column programacoes_pagamento.status does not exist" },
    "programacao_contas:saldo_considerado,ativa,ordem": { code: "42501", message: "permission denied for table programacao_contas" },
  };
  const cliente = {
    from: (tabela) => ({
      select: (colunas) => ({
        // Linha nenhuma devolvida: é exatamente o caso de RLS restritiva.
        limit: async () => ({ data: [], error: respostas[`${tabela}:${colunas}`] ?? null }),
      }),
    }),
  };

  const resultado = await verificarEstruturaFase1(cliente);
  assert.equal(resultado.ok, false);
  assert.deepEqual(resultado.faltando, ["programacoes_pagamento.status"]);
  assert.deepEqual(resultado.naoVerificado, ["programacao_contas"]);

  const semFalha = { from: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }) };
  const tudoCerto = await verificarEstruturaFase1(semFalha);
  assert.equal(tudoCerto.ok, true);
  assert.deepEqual(tudoCerto.faltando, []);
});

test("migration de reparo é idempotente, aditiva e não movimenta dinheiro", async () => {
  const sql = await read("supabase/migrations/20260827130000_reaplicar_estrutura_pagamentos_fase_1.sql");
  assert.match(sql, /^-- Reaplicação idempotente/);
  assert.match(sql, /begin;/);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /add column if not exists status/);
  assert.match(sql, /add column if not exists saldo_considerado/);
  assert.match(sql, /add column if not exists ativa/);
  assert.match(sql, /add column if not exists cadastrar_fornecedor_posteriormente/);
  assert.match(sql, /create index if not exists/);
  assert.match(sql, /create or replace function public\.salvar_planejamento_programacao/);
  assert.match(sql, /create or replace function public\.marcar_programacao_em_analise/);
  assert.doesNotMatch(sql, /\bdelete\b|drop table|drop function|truncate/i);
  assert.doesNotMatch(sql, /insert into public\.saldos_historico|update public\.saldos_historico/i);
  assert.doesNotMatch(sql, /transferencias_contas|pagamentos_baixas|marcar_pagamento_pago/i);
});

test("migration aplicada da fase 1 continua intacta", async () => {
  const sql = await read(migrationPlanejamento);
  assert.match(sql, /create or replace function public\.salvar_planejamento_programacao/);
  assert.match(sql, /create or replace function public\.marcar_programacao_em_analise/);
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
  for (const texto of ["PROGRAMAÇÃO DIÁRIA DE PAGAMENTOS", "Contas utilizadas", "Pagamentos propostos", "TOTAL DAS CONTAS", "TOTAL PROGRAMADO", "SALDO RESTANTE"]) assert.match(documento, new RegExp(texto, "i"));
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

test("lista de fornecedores mostra quem tem valor em aberto primeiro, do maior para o menor", () => {
  const ordenados = ordenarFornecedoresPorAberto([
    { razao_social: "ZETA", valor_em_aberto: 0 },
    { razao_social: "BETA", valor_em_aberto: 15000 },
    { razao_social: "ALFA", valor_em_aberto: 0 },
    { razao_social: "GAMA", valor_em_aberto: 250000 },
    { razao_social: "DELTA", valor_em_aberto: 3050.75 },
  ]);
  assert.deepEqual(ordenados.map((item) => item.razao_social), ["GAMA", "BETA", "DELTA", "ALFA", "ZETA"]);
  // Nenhum valor é tocado pela ordenação.
  assert.deepEqual(ordenados.map((item) => item.valor_em_aberto), [250000, 15000, 3050.75, 0, 0]);
});

test("blocos de contas e de fornecedores recolhem depois da confirmação", async () => {
  const pagina = await read("src/pages/PagamentosRedesenhado.jsx");
  for (const rotulo of ["CONFIRMAR CONTAS", "ALTERAR CONTAS", "CONFIRMAR FORNECEDORES", "ALTERAR FORNECEDORES"]) {
    assert.match(pagina, new RegExp(rotulo));
  }
  // A lista completa só existe na tela enquanto o bloco está aberto.
  assert.match(pagina, /\{!contasConfirmadas && <div className="print:hidden">/);
  assert.match(pagina, /\{!fornecedoresConfirmados && <div className="max-h-\[330px\] overflow-y-auto print:hidden">/);
  // Confirmado, sobra o resumo do que foi escolhido -- com o valor editável nos fornecedores.
  assert.match(pagina, /contasSelecionadasComSaldo\.map\(\(conta\) => <div/);
  assert.match(pagina, /fornecedoresConfirmados \? "" : "hidden print:block"/);
  assert.match(pagina, /onValorChange=\{\(valor\) => editarValor\(pagamento, valor\)\}/);
  // Programação já salva abre recolhida; programação nova abre com as listas.
  assert.match(pagina, /setContasConfirmadas\(\(vinculadas \?\? \[\]\)\.length > 0\)/);
  assert.match(pagina, /setFornecedoresConfirmados\(\(itens \?\? \[\]\)\.length > 0\)/);
  // Salvar recarrega os dados sem recolher nem reabrir o que o usuário deixou aberto.
  assert.match(pagina, /carregarProgramacao\(programacao\.id, \{ manterRecolhimento: true \}\)/);
});

test("confirmar bloco é só apresentação: não grava nem movimenta saldo", async () => {
  const pagina = await read("src/pages/PagamentosRedesenhado.jsx");
  const recolhimento = pagina.slice(pagina.indexOf("function confirmarContas"), pagina.indexOf("function alternarConta"));
  assert.match(recolhimento, /setContasConfirmadas\(true\)/);
  assert.match(recolhimento, /setFornecedoresConfirmados\(true\)/);
  assert.doesNotMatch(recolhimento, /supabase|rpc\(|insert|update|salvar/i);
  // Os totalizadores do topo seguem fora de qualquer condição de recolhimento.
  const topo = pagina.slice(pagina.indexOf("Saldo da programação"), pagina.indexOf("Secretaria"));
  assert.doesNotMatch(topo, /contasConfirmadas|fornecedoresConfirmados/);
});

test("impressão da página não leva listas completas nem controles de interface", async () => {
  const pagina = await read("src/pages/PagamentosRedesenhado.jsx");
  // Busca, seleção em massa, chips, avisos e barras de botão ficam fora do papel.
  for (const trecho of [
    // A busca de conta é a do seletor compartilhado ("Buscar conta..."), e a
    // lista inteira de contas continua fora do papel.
    /<SeletorContas/,
    // A busca de fornecedor agora encontra por apelido também; o campo continua
    // fora do papel.
    /placeholder="Buscar por nome, apelido, razão social ou CNPJ\/CPF"/,
    /Selecionar todas/,
    /Adicionar fornecedor avulso/,
  ]) assert.match(pagina, trecho);
  assert.match(pagina, /className="relative mt-3 print:hidden"/);
  assert.match(pagina, /className="border-t border-black\/5 p-2\.5 print:hidden"/);
  assert.match(pagina, /className="flex flex-wrap gap-2 print:hidden"/);
  assert.match(pagina, /overflow-x-auto pb-1 print:hidden/);
  // O resumo confirmado é o que sobra impresso, com o valor como texto.
  assert.match(pagina, /className="hidden text-right tabular-nums print:block"/);
  assert.match(pagina, /contasConfirmadas \? "" : "hidden print:block"/);
});

test("documento tem cabeçalho, colunas e totais do papel entregue ao gestor", async () => {
  const documento = await read("src/lib/programacaoDocumento.js");
  // Cabeçalho: secretaria, data da programação e data e hora da emissão.
  for (const trecho of ["Secretaria:", "Data da programação:", "Emitido em:"]) assert.match(documento, new RegExp(trecho));
  // Colunas exatas dos dois blocos: os pagamentos ficaram em fornecedor e valor.
  assert.match(documento, /export const COLUNAS_CONTAS = \["BANCO", "Nº DA CONTA", "SALDO", "NOME DA CONTA"\]/);
  assert.match(documento, /export const COLUNAS_PAGAMENTOS = \["FORNECEDOR", "VALOR"\]/);
  // Nada de coluna para marcação à mão, nem de linhas de assinatura ou anotação.
  assert.doesNotMatch(documento, /aprovado|APROVADO|VALOR EM ABERTO|Responsável pela elaboração|Aprovação|OBSERVAÇÕES|linha-manuscrita/);
  // Totais em destaque e numeração de páginas.
  for (const trecho of ["TOTAL DAS CONTAS", "TOTAL PROGRAMADO", "SALDO RESTANTE", "Página \\$\\{indice \\+ 1\\} de", "Página \\$\\{pagina\\} de \\$\\{paginas\\}"]) {
    assert.match(documento, new RegExp(trecho));
  }
  // Excesso é informado como diferença, sem alarme.
  assert.match(documento, /Diferença de \$\{escapar\(formatBRL\(Math\.abs\(dados\.restante\)\)\)\} acima do saldo/);
  assert.doesNotMatch(documento, /ACIMA DO SALDO DISPONÍVEL|ATENÇÃO|ALERTA/);
});

test("documento pagina em A4 retrato repetindo o cabeçalho da tabela em cada folha", async () => {
  const { montarPaginas } = await import("../src/lib/programacaoPaginacao.js");
  const contas = Array.from({ length: 12 }, (_, indice) => ({ banco: "BANCO", conta: String(indice), saldo: 1000, nome: "CONTA" }));
  const pagamentos = Array.from({ length: 60 }, (_, indice) => ({ fornecedor: "FORNECEDOR " + indice, valor: 1500 }));
  const paginas = montarPaginas({ contas, pagamentos, totalContas: 12000, totalProgramado: 90000, restante: -78000 });

  assert.ok(paginas.length > 1, "60 fornecedores não cabem em uma folha");
  // Toda folha que continua a relação repete o título e as colunas do bloco.
  const fatias = paginas.flatMap((pagina) => pagina.blocos).filter((bloco) => bloco.tipo === "pagamentos");
  assert.ok(fatias.length > 1);
  assert.equal(fatias.reduce((total, fatia) => total + fatia.linhas.length, 0), 60);
  // O somatório e o saldo restante fecham o documento, na última folha e nesta ordem.
  const ultima = paginas[paginas.length - 1].blocos.map((bloco) => bloco.tipo);
  assert.deepEqual(ultima.slice(-2), ["totalProgramado", "saldoRestante"]);
  // Linhas em branco para anotação e linhas de assinatura saíram do documento.
  const tipos = new Set(paginas.flatMap((pagina) => pagina.blocos).map((bloco) => bloco.tipo));
  assert.ok(!tipos.has("observacoes") && !tipos.has("assinaturas"));
});

test("botões de impressão, PDF e Excel ficam na faixa fixa e o papel recebe a secretaria", async () => {
  const pagina = await read("src/pages/PagamentosRedesenhado.jsx");
  // O botão vive na faixa fixa do topo: é o documento levado ao gestor, não pode depender de rolagem.
  const faixa = pagina.slice(pagina.indexOf("sticky top-0"), pagina.indexOf("mb-3 grid gap-2 rounded-xl"));
  assert.match(faixa, /onClick=\{imprimir\}/);
  assert.match(faixa, /Imprimir programação para análise/);
  assert.match(faixa, /onClick=\{gerarPdf\}/);
  assert.match(faixa, /onClick=\{exportarExcel\}/);
  assert.match(faixa, /Excel/);
  // Cabeçalho sai da própria tela.
  assert.match(pagina, /secretaria: nomeSecretariaSelecionada/);
  assert.match(pagina, /emissao: agoraBR\(\)/);
  // Os pagamentos vão ao papel em duas colunas: fornecedor e valor.
  assert.match(pagina, /pagamentos: pagamentos\.map\(\(item\) => \(\{ fornecedor: nomePagamento\(item\), valor: numero\(item\.valor_a_pagar\) \}\)\)/);
});

test("as chaves enviadas pela tela são as que o documento imprime", async () => {
  const pagina = await read("src/pages/PagamentosRedesenhado.jsx");
  // A tela renomeia os campos do banco para os nomes que o documento espera. Se
  // um lado mudar sozinho, o papel sai com "--" no lugar do dado e ninguém erra
  // em voz alta: o número da conta simplesmente desaparece do que vai ao gestor.
  assert.match(pagina, /banco: conta\.banco, conta: conta\.numero_conta, saldo: conta\.saldo, nome: conta\.nome_conta/);

  const { htmlProgramacao } = await import("../src/lib/programacaoDocumento.js");
  const documento = htmlProgramacao({
    secretaria: "SECRETARIA MUNICIPAL DE EDUCAÇÃO",
    data: "28/08/2026",
    contas: [{ banco: "BANCO DO BRASIL", conta: "1234-5 / 98.765-4", saldo: 184320.55, nome: "FPM - RECURSOS LIVRES" }],
    pagamentos: [{ fornecedor: "COMERCIAL SANTA CLARA LTDA", valor: 20000 }],
    totalContas: 184320.55,
    totalProgramado: 20000,
    restante: 164320.55,
  });
  for (const dado of ["BANCO DO BRASIL", "1234-5 / 98.765-4", "FPM - RECURSOS LIVRES", "COMERCIAL SANTA CLARA LTDA"]) {
    assert.ok(documento.includes(dado), "dado ausente no documento: " + dado);
  }
  // Nenhum campo preenchido pode ter virado o marcador de vazio.
  assert.doesNotMatch(documento, /<td>--<\/td>/);
});

test("tela do módulo é densa: linhas baixas, blocos discretos e sem textos longos", async () => {
  const pagina = await read("src/pages/PagamentosRedesenhado.jsx");
  // Títulos de seção discretos, não chamadas grandes.
  for (const rotulo of ["1.<\\/span> Contas de trabalho", "2.<\\/span> Proposta", "3.<\\/span> Valores"]) {
    assert.match(pagina, new RegExp(rotulo));
  }
  assert.doesNotMatch(pagina, /font-serif text-xl text-\[#17352F\]/);
  // Os textos explicativos longos saíram da tela.
  assert.doesNotMatch(pagina, /Nenhuma conta é debitada, reservada ou bloqueada/);
  assert.doesNotMatch(pagina, /O valor é totalmente editável e pode ser menor que o total em aberto/);
  // Linhas de tabela compactas e valores monetários ainda em negrito.
  assert.doesNotMatch(pagina, /border-b border-black\/5 px-4 py-3/);
  assert.match(pagina, /<strong className="tabular-nums">\{formatBRL\(conta\.saldo\)\}<\/strong>/);
});

test("saldo das contas sai centralizado e em negrito, na impressão e no PDF", async () => {
  const documento = await read("src/lib/programacaoDocumento.js");
  // CSS da impressão: a coluna SALDO é centralizada e continua em negrito.
  assert.match(documento, /\.saldo \{ text-align: center;/);
  assert.match(documento, /td\.saldo \{ font-weight: bold; \}/);
  assert.match(documento, /<td class="saldo">\$\{escapar\(formatBRL\(conta\.saldo\)\)\}/);
  assert.match(documento, /<th class="saldo">\$\{COLUNAS_CONTAS\[2\]\}/);
  // PDF: mesma coluna, mesmo alinhamento.
  assert.match(documento, /cellWidth: util \* 0\.22, halign: "center", fontStyle: "bold"/);
});

test("pagamentos propostos têm duas colunas e o somatório cai sob a coluna dos valores", async () => {
  const { htmlProgramacao } = await import("../src/lib/programacaoDocumento.js");
  const documento = htmlProgramacao({
    secretaria: "SECRETARIA DE FINANÇAS",
    data: "28/08/2026",
    contas: [{ banco: "BANCO DO BRASIL", conta: "1234-5", saldo: 629746.73, nome: "FPM" }],
    pagamentos: [{ fornecedor: "FORNECEDOR A", valor: 10000 }, { fornecedor: "FORNECEDOR B", valor: 5000 }],
    totalContas: 629746.73,
    totalProgramado: 15000,
    restante: 614746.73,
  });

  // Duas colunas e nada mais no cabeçalho dos pagamentos.
  assert.match(documento, /<table class="propostos">.*?<thead><tr><th>FORNECEDOR<\/th><th class="valor">VALOR<\/th><\/tr><\/thead>/s);
  // Somatório e destaque usam o mesmo colgroup da tabela: os valores alinham.
  const colgroup = documento.match(/<colgroup><col style="width:62%"><col style="width:38%"><\/colgroup>/g);
  assert.equal(colgroup.length, 3, "tabela, somatório e saldo restante compartilham as duas colunas");
  // O somatório vem imediatamente depois da tabela de fornecedores, e o saldo restante depois dele.
  const ordem = ["</table><table class=\"somatorio\"", "TOTAL PROGRAMADO:", "<table class=\"destaque\"", "SALDO RESTANTE:"];
  let posicao = -1;
  for (const marca of ordem) {
    const encontrado = documento.indexOf(marca, posicao + 1);
    assert.ok(encontrado > posicao, "fora de ordem no documento: " + marca);
    posicao = encontrado;
  }
  // Saldo restante em corpo maior que os demais valores do documento.
  assert.match(documento, /\.destaque \.valor \{ height: \d+(?:\.\d+)?mm; font-size: 15pt;/);
  assert.match(documento, /\.somatorio \.valor \{ font-size: 10\.5pt;/);
});

test("documento sai com a identidade visual do sistema: brasão, órgão, lema e cor institucional", async () => {
  const { htmlProgramacao, IDENTIDADE } = await import("../src/lib/programacaoDocumento.js");
  const documento = htmlProgramacao({ secretaria: "SECRETARIA DE FINANÇAS", data: "28/08/2026", contas: [], pagamentos: [] });

  assert.equal(IDENTIDADE.orgao, "SECRETARIA DE FINANÇAS");
  assert.equal(IDENTIDADE.lema, "GESTÃO QUE TRANSFORMA");
  // O brasão vai embutido, com o mesmo desenho de public/brasao.svg.
  const brasao = await read("public/brasao.svg");
  const escudo = brasao.match(/M60 22 L92 32 V70 [^"]+/)[0];
  assert.ok(documento.includes(escudo), "o escudo do brasão do sistema não está no documento");
  assert.match(documento, /aria-label="Brasão da Secretaria de Finanças"/);
  assert.match(documento, /GESTÃO QUE TRANSFORMA/);
  // Cabeçalho de tabela na cor institucional, com texto claro, e faixas alternadas.
  assert.match(documento, /th \{[^}]*background: #17352F; color: #fff;/);
  assert.match(documento, /tbody tr:nth-child\(even\) td \{ background: #E5EFEA; \}/);
  // Quadro do saldo restante na cor institucional.
  assert.match(documento, /\.destaque td \{ border: 0; background: #17352F; color: #fff; \}/);
  // As cores são as que o sistema já usa: nada de paleta nova.
  const cores = new Set((documento.match(/#[0-9A-Fa-f]{6}/g) ?? []).map((cor) => cor.toUpperCase()));
  for (const cor of cores) {
    assert.ok(["#17352F", "#E5EFEA", "#D5DBDA", "#607671", "#0F2A44", "#C9A227", "#FBFAF7"].includes(cor), "cor fora da paleta do sistema: " + cor);
  }
});

test("programação de um dia comum cabe em uma folha, sem espaços em branco sobrando", async () => {
  const { montarPaginas } = await import("../src/lib/programacaoPaginacao.js");
  const paginas = montarPaginas({
    contas: Array.from({ length: 6 }, () => ({ banco: "BANCO", conta: "1", saldo: 1000, nome: "CONTA" })),
    pagamentos: Array.from({ length: 20 }, (_, indice) => ({ fornecedor: "FORNECEDOR " + indice, valor: 1000 })),
    totalContas: 6000,
    totalProgramado: 20000,
    restante: -14000,
  });
  assert.equal(paginas.length, 1, "6 contas e 20 fornecedores têm de caber em uma folha");
});

test("exportação em Excel traz cabeçalho, as duas tabelas, totais somáveis e datas como data", async () => {
  const { montarPlanilhaProgramacao } = await import("../src/lib/programacaoDocumento.js");

  const { planilha, arquivo } = montarPlanilhaProgramacao({
    secretaria: "SECRETARIA MUNICIPAL DE EDUCAÇÃO",
    data: "28/08/2026",
    emissao: "28/08/2026 14:32",
    contas: [
      { banco: "BANCO DO BRASIL", conta: "1234-5", saldo: 184320.55, nome: "FPM" },
      { banco: "CAIXA", conta: "9-9", saldo: 430426.18, nome: "FUNDEB" },
    ],
    pagamentos: [{ fornecedor: "FORNECEDOR A", valor: 10000 }, { fornecedor: "FORNECEDOR B", valor: 5000 }],
    totalContas: 614746.73,
    totalProgramado: 15000,
    restante: 599746.73,
  });

  assert.equal(arquivo, "programacao-diaria-28-08-2026.xlsx");

  // Cabeçalho: secretaria, data da programação e data de emissão.
  assert.match(planilha.A1.v, /SECRETARIA DE FINANÇAS — GESTÃO QUE TRANSFORMA/);
  assert.equal(planilha.A2.v, "PROGRAMAÇÃO DIÁRIA DE PAGAMENTOS");
  assert.equal(planilha.B4.v, "SECRETARIA MUNICIPAL DE EDUCAÇÃO");
  // Datas em formato de data, não como texto.
  for (const referencia of ["B5", "B6"]) {
    assert.equal(planilha[referencia].t, "d");
    assert.ok(planilha[referencia].v instanceof Date);
  }
  assert.match(planilha.B5.z, /dd\/mm\/yyyy/);

  // Contas utilizadas: Banco | Nº da Conta | Saldo | Nome da Conta, com o total.
  assert.deepEqual([planilha.A9.v, planilha.B9.v, planilha.C9.v, planilha.D9.v], ["Banco", "Nº da Conta", "Saldo", "Nome da Conta"]);
  assert.equal(planilha.A12.v, "TOTAL DAS CONTAS");
  assert.equal(planilha.C12.f, "SUM(C10:C11)");

  // Pagamentos propostos: Fornecedor | Valor, com o total programado como somatório.
  assert.deepEqual([planilha.A15.v, planilha.B15.v], ["Fornecedor", "Valor"]);
  assert.equal(planilha.A18.v, "TOTAL PROGRAMADO");
  assert.equal(planilha.B18.f, "SUM(B16:B17)");

  // Saldo restante, conferido pela própria planilha.
  assert.equal(planilha.A20.v, "SALDO RESTANTE");
  assert.equal(planilha.B20.f, "C12-B18");

  // Todo valor monetário é número com formato de moeda -- dá para somar na planilha.
  for (const referencia of ["C10", "C11", "C12", "B16", "B17", "B18", "B20"]) {
    assert.equal(planilha[referencia].t, "n", referencia + " deveria ser numérico");
    assert.equal(planilha[referencia].z, "R$ #,##0.00");
  }
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
