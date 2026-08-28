// Testes obrigatórios da Fase 2 dos Pagamentos Diários: revisão pós-análise,
// aprovação e execução financeira (conta por pagamento e transferência entre
// contas).
//
// As regras da fase que estes testes travam:
//
//   APROVAR NÃO É PAGAR
//   ATRIBUIR CONTA NÃO DEBITA CONTA
//   TRANSFERÊNCIA ENTRE CONTAS NÃO É DESPESA
//   SÓ A TRANSFERÊNCIA CONFIRMADA MOVIMENTA SALDO NESTA FASE
//   UMA TRANSFERÊNCIA NÃO PODE SER EXECUTADA DUAS VEZES
//   TRANSFERÊNCIA NÃO SE EXCLUI — SE ESTORNA
//
// O que não dá para rodar sem banco (atomicidade, índice único, RLS) é travado
// pelo texto da migration, que é a única coisa que realmente faz a regra valer.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  aplicarContaEmPagamentos,
  aplicarContaEmTodos,
  contasAtribuiveis,
  emExecucao,
  emRevisaoPosAnalise,
  impedimentosParaAprovar,
  podeRevisarProposta,
  resumoAprovacao,
  resumoExecucao,
  statusLabelExecucao,
} from "../src/lib/execucaoProgramacao.js";
import {
  aplicarTransferenciaEmSaldos,
  conferirTransferenciaMultipla,
  pernasParaEnvio,
  totalDosSaldos,
} from "../src/lib/regrasTransferencia.js";
import {
  motivoBloqueioTransferencia,
  secretariasRelacionadas,
  transferenciaPermitida,
} from "../src/lib/segregacaoSecretarias.js";
import {
  calcularRestante,
  definirValorProgramado,
  somarContasSelecionadas,
  somarPagamentos,
} from "../src/lib/planejamentoPagamentos.js";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20260828140000_execucao_financeira_fase_2.sql";
const PAGINA = "src/pages/PagamentosRedesenhado.jsx";

// Recorta o corpo de uma função da migration para conferir uma regra dentro do
// escopo certo -- "não movimenta saldo" tem de valer na função da aprovação, não
// no arquivo inteiro (a transferência movimenta, e deve).
function corpoDaFuncao(sql, nome) {
  const inicio = sql.indexOf(`create or replace function public.${nome}(`);
  assert.ok(inicio > 0, `função ausente na migration: ${nome}`);
  const fim = sql.indexOf("grant execute on function public." + nome, inicio);
  assert.ok(fim > inicio, `grant ausente para a função: ${nome}`);
  return sql.slice(inicio, fim);
}

const conta = (id, saldo, secretariaId = 1, secretariaNome = "SECRETARIA DE EDUCAÇÃO") => ({
  id,
  saldo,
  nome_conta: `CONTA ${id}`,
  banco: "BANCO",
  numero_conta: String(id),
  secretaria_id: secretariaId,
  secretaria_nome: secretariaNome,
  secretaria: secretariaNome,
});

// ---------------------------------------------------------------------------
// 1. Revisão depois da análise
// ---------------------------------------------------------------------------

test("volta da análise: retira fornecedor, acrescenta outro, altera valor e recalcula", () => {
  const emAnalise = { id: 10, status: "em_analise", fechado: false };
  assert.equal(podeRevisarProposta(emAnalise), true);
  assert.equal(emRevisaoPosAnalise(emAnalise), true);
  assert.equal(statusLabelExecucao("em_analise"), "EM ANÁLISE");

  const contas = [conta(1, 300000), conta(2, 100000)];
  const selecionadas = new Set([1, 2]);
  let pagamentos = [
    { id: 1, fornecedor_id: 7, valor_a_pagar: 120000 },
    { id: 2, fornecedor_id: 8, valor_a_pagar: 80000 },
  ];

  const saldo = somarContasSelecionadas(contas, selecionadas);
  assert.equal(saldo, 400000);
  assert.equal(somarPagamentos(pagamentos), 200000);

  // Retira um fornecedor da programação.
  pagamentos = pagamentos.filter((item) => item.fornecedor_id !== 8);
  assert.equal(somarPagamentos(pagamentos), 120000);

  // Acrescenta outro fornecedor.
  pagamentos = [...pagamentos, { id: 3, fornecedor_id: 9, valor_a_pagar: 50000 }];
  assert.equal(somarPagamentos(pagamentos), 170000);

  // Altera o valor de um deles.
  pagamentos = definirValorProgramado(pagamentos, pagamentos[0], 90000);
  assert.equal(somarPagamentos(pagamentos), 140000);
  assert.equal(calcularRestante(saldo, somarPagamentos(pagamentos)), 260000);
});

test("retirar da programação não é excluir fornecedor: nada além da própria programação é tocado", async () => {
  const [pagina, sql] = await Promise.all([read(PAGINA), read(MIGRATION)]);
  // Na tela, retirar é filtrar a lista local -- não existe delete de fornecedor.
  assert.match(pagina, /setPagamentos\(\(itens\) => itens\.filter\(\(item\) => item !== pagamento\)\)/);
  assert.match(pagina, /Retirar da programação não é excluir fornecedor/);
  assert.doesNotMatch(pagina, /from\("fornecedores"\)\.delete|\.delete\(\)/);
  // A migration não apaga nada em lugar nenhum (o único "delete" que aparece é
  // o revoke do privilégio -- que justamente tira o direito de apagar).
  assert.doesNotMatch(sql, /delete from|drop table|drop function|truncate\s+(table\s+)?public\./i);
  assert.doesNotMatch(sql, /fornecedores\s+set\s+|update public\.fornecedores/i);
});

test("acrescentar e retirar conta recalcula o saldo disponível na hora", () => {
  const contas = [conta(1, 300000), conta(2, 100000), conta(3, 250000)];
  let selecionadas = new Set([1]);
  assert.equal(somarContasSelecionadas(contas, selecionadas), 300000);
  selecionadas = new Set([1, 3]);
  assert.equal(somarContasSelecionadas(contas, selecionadas), 550000);
  selecionadas = new Set([3]);
  assert.equal(somarContasSelecionadas(contas, selecionadas), 250000);

  const resumo = resumoAprovacao({
    contasSelecionadas: contas.filter((item) => selecionadas.has(item.id)),
    pagamentos: [{ valor_a_pagar: 200000 }],
  });
  assert.equal(resumo.saldoDisponivel, 250000);
  assert.equal(resumo.restante, 50000);
});

// ---------------------------------------------------------------------------
// 2 e 3. Em análise e aprovação
// ---------------------------------------------------------------------------

test("marcar em análise não movimenta saldo nenhum", async () => {
  const pagina = await read(PAGINA);
  const bloco = pagina.slice(pagina.indexOf("async function marcarEmAnalise"), pagina.indexOf("async function contasDefinidasDosPagamentos"));
  assert.match(bloco, /marcar_programacao_em_analise/);
  assert.match(bloco, /Nenhum saldo foi movimentado/);
  assert.doesNotMatch(bloco, /saldos_historico|transferencia|conta_origem_id/i);
});

test("aprovar não debita conta, não dá baixa e não marca nota como paga", async () => {
  const sql = await read(MIGRATION);
  const corpo = corpoDaFuncao(sql, "aprovar_programacao_pagamento");
  assert.match(corpo, /set status = 'aprovada'/);
  assert.match(corpo, /aprovada_em = now\(\)/);
  assert.match(corpo, /'movimentou_saldo', false/);
  // Nada de saldo, de baixa, de nota paga ou de saldo de fornecedor.
  assert.doesNotMatch(corpo, /saldos_historico|pagamentos_baixas|pagamento_movimentacoes|valores_em_aberto/i);
  assert.match(sql, /APROVADO NAO E PAGO/);
});

test("resumo da aprovação mostra contas, saldo, fornecedores, total e restante", () => {
  const resumo = resumoAprovacao({
    contasSelecionadas: [conta(1, 300000), conta(2, 100000)],
    pagamentos: [{ valor_a_pagar: 120000 }, { valor_a_pagar: 80000 }, { valor_a_pagar: 50000 }],
  });
  assert.equal(resumo.quantidadeContas, 2);
  assert.equal(resumo.saldoDisponivel, 400000);
  assert.equal(resumo.quantidadeFornecedores, 3);
  assert.equal(resumo.totalAprovado, 250000);
  assert.equal(resumo.restante, 150000);
  assert.equal(resumo.acimaDoSaldo, false);

  // Programação sem conta ou sem fornecedor não é aprovável.
  assert.deepEqual(
    impedimentosParaAprovar({ programacao: { status: "em_analise" }, contasSelecionadas: [], pagamentos: [] }),
    ["Selecione ao menos uma conta de trabalho.", "Inclua ao menos um fornecedor na programação."]
  );
  assert.deepEqual(impedimentosParaAprovar({
    programacao: { status: "em_analise" },
    contasSelecionadas: [conta(1, 1)],
    pagamentos: [{ valor_a_pagar: 1 }],
  }), []);
});

test("aprovada aguarda execução e tranca a proposta sem fechar a programação", () => {
  const aprovada = { id: 3, status: "aprovada", fechado: false };
  assert.equal(statusLabelExecucao("aprovada"), "APROVADA / AGUARDANDO EXECUÇÃO");
  assert.equal(emExecucao(aprovada), true);
  assert.equal(podeRevisarProposta(aprovada), false);
  assert.equal(emExecucao({ status: "aprovada", fechado: true }), false);
});

// ---------------------------------------------------------------------------
// 4 e 5. Conta por pagamento, individual e em lote
// ---------------------------------------------------------------------------

test("cada fornecedor pode sair de uma conta diferente na mesma programação", () => {
  const contas = [conta(1, 300000), conta(2, 100000)];
  let pagamentos = [
    { id: 1, valor_a_pagar: 50000 },
    { id: 2, valor_a_pagar: 30000 },
  ];
  pagamentos = aplicarContaEmPagamentos(pagamentos, [1], 1);
  pagamentos = aplicarContaEmPagamentos(pagamentos, [2], 2);
  assert.deepEqual(pagamentos.map((item) => item.conta_origem_id), [1, 2]);

  const resumo = resumoExecucao(pagamentos, contas);
  assert.equal(resumo.comConta, 2);
  assert.equal(resumo.semConta, 0);
  assert.equal(resumo.completo, true);
  assert.equal(resumo.distribuicao.length, 2);
});

test("aplicar uma conta a 10 fornecedores e depois trocar só 1", () => {
  const pagamentos = Array.from({ length: 10 }, (_, indice) => ({ id: indice + 1, valor_a_pagar: 1000 }));
  const todos = aplicarContaEmTodos(pagamentos, 5);
  assert.equal(todos.filter((item) => item.conta_origem_id === 5).length, 10);

  const trocado = aplicarContaEmPagamentos(todos, [7], 9);
  assert.equal(trocado.filter((item) => item.conta_origem_id === 5).length, 9);
  assert.equal(trocado.find((item) => item.id === 7).conta_origem_id, 9);
});

test("só contas da secretaria da programação e entre as de trabalho podem ser atribuídas", () => {
  const contas = [conta(1, 100), conta(2, 100), conta(3, 100, 2, "SECRETARIA DE SAÚDE")];
  const disponiveis = contasAtribuiveis({ contas, contasSelecionadas: new Set([1, 3]), secretariaId: 1 });
  assert.deepEqual(disponiveis.map((item) => item.id), [1]);
});

test("atribuir conta não debita conta: o débito é da baixa", async () => {
  const sql = await read(MIGRATION);
  const corpo = corpoDaFuncao(sql, "definir_conta_origem_pagamento");
  assert.match(corpo, /set conta_origem_id = p_conta_id/);
  assert.match(corpo, /'debitou_conta', false/);
  assert.match(corpo, /Só é possível usar contas da secretaria da programação\./);
  assert.match(corpo, /contas de trabalho selecionadas na programação/);
  assert.doesNotMatch(corpo, /saldos_historico|pagamentos_baixas|pagamento_movimentacoes/i);
  assert.match(sql, /CONTA DEFINIDA NAO E DEBITO/);
});

// ---------------------------------------------------------------------------
// 6 e 7. Transferência entre contas
// ---------------------------------------------------------------------------

test("A 300.000 e C 100.000, transferindo 200.000: A fica 100.000, C fica 300.000 e o total não muda", () => {
  const saldos = { A: 300000, C: 100000 };
  const antes = totalDosSaldos(saldos);
  const depois = aplicarTransferenciaEmSaldos(saldos, "A", "C", 200000);
  assert.equal(depois.A, 100000);
  assert.equal(depois.C, 300000);
  assert.equal(totalDosSaldos(depois), antes);
  assert.equal(totalDosSaldos(depois), 400000);
});

test("várias origens para um destino na mesma operação, com valor por origem", () => {
  const destino = conta(9, 50000);
  const conferencia = conferirTransferenciaMultipla({
    destino,
    origens: [
      { conta: conta(1, 300000), valor: 120000 },
      { conta: conta(2, 100000), valor: 40000 },
      { conta: conta(3, 80000), valor: 10000 },
    ],
  });

  assert.equal(conferencia.totalTransferir, 170000);
  assert.equal(conferencia.saldoDestinoAtual, 50000);
  assert.equal(conferencia.saldoDestinoDepois, 220000);
  assert.equal(conferencia.podeConfirmar, true);
  assert.deepEqual(conferencia.linhas.map((linha) => linha.saldoDepois), [180000, 60000, 70000]);
  // Não é despesa: o patrimônio somado das contas envolvidas não muda.
  assert.equal(conferencia.patrimonioAntes, conferencia.patrimonioDepois);
  assert.equal(conferencia.patrimonioPreservado, true);

  assert.deepEqual(pernasParaEnvio([
    { conta: conta(1, 300000), valor: 120000 },
    { conta: conta(2, 100000), valor: 40000 },
    { conta: null, valor: 900 },
  ]), [
    { sourceAccountId: 1, amount: 120000 },
    { sourceAccountId: 2, amount: 40000 },
  ]);
});

test("a mesma origem repetida e o saldo insuficiente barram a confirmação", () => {
  const repetida = conferirTransferenciaMultipla({
    destino: conta(9, 0),
    origens: [{ conta: conta(1, 500), valor: 100 }, { conta: conta(1, 500), valor: 100 }],
  });
  assert.equal(repetida.podeConfirmar, false);
  assert.deepEqual(repetida.origensRepetidas, [1]);

  const semSaldo = conferirTransferenciaMultipla({
    destino: conta(9, 0),
    origens: [{ conta: conta(1, 500), valor: 900 }],
  });
  assert.equal(semSaldo.podeConfirmar, false);
  assert.equal(semSaldo.linhas[0].erro, "Saldo insuficiente nesta conta de origem.");
});

test("transferência entre contas próprias não é despesa e não entra em nenhum relatório", async () => {
  const [sql, transporte, funcao] = await Promise.all([
    read(MIGRATION),
    read("src/lib/transferenciasContas.js"),
    read("netlify/functions/account-transfers.mts"),
  ]);
  const confirmacao = corpoDaFuncao(sql, "confirmar_transferencias_programacao");
  const estorno = corpoDaFuncao(sql, "estornar_transferencia");

  // As tabelas lidas pelos relatórios de pagamento não são tocadas.
  for (const corpo of [confirmacao, estorno]) {
    assert.doesNotMatch(corpo, /pagamento_movimentacoes|pagamentos_baixas|valores_em_aberto/i);
    assert.match(corpo, /'eh_despesa', false/);
  }
  // O movimento é só nas contas: origem debita, destino credita.
  assert.match(confirmacao, /insert into public\.saldos_historico/);
  assert.match(sql, /NAO E DESPESA/);
  assert.doesNotMatch(transporte, /despesa|baixa/i);
  assert.doesNotMatch(funcao, /pagamentos_baixas|marcar_pagamento_pago/i);
});

test("transferência é atômica e não acontece duas vezes", async () => {
  const [sql, transporte, painel, funcao] = await Promise.all([
    read(MIGRATION),
    read("src/lib/transferenciasContas.js"),
    read("src/components/pagamentos/ModalTransferenciaEntreContas.jsx"),
    read("netlify/functions/account-transfers.mts"),
  ]);

  // Índice único na chave: é o banco que impede a segunda execução.
  assert.match(sql, /create unique index if not exists transferencia_lotes_idempotencia_idx\s*\n?\s*on public\.transferencia_lotes \(chave_idempotencia\)/);
  const confirmacao = corpoDaFuncao(sql, "confirmar_transferencias_programacao");
  assert.match(confirmacao, /on conflict \(chave_idempotencia\) do nothing/);
  assert.match(confirmacao, /ja_confirmada/);
  // Saída e entrada na mesma função: uma só transação.
  assert.match(confirmacao, /language plpgsql/);
  assert.match(confirmacao, /pg_advisory_xact_lock/);

  // A chave é criada UMA vez por operação, não a cada clique.
  assert.match(painel, /React\.useRef\(novaChaveIdempotencia\(\)\)/);
  assert.match(painel, /chaveIdempotencia: chave\.current/);
  assert.match(transporte, /A transferência precisa de um identificador único\./);
  assert.match(funcao, /precisa de um identificador único/);
});

test("saldo é gravado por upsert: a mesma data nunca ganha uma segunda linha", async () => {
  const sql = await read(MIGRATION);
  // saldoRealPorConta guarda a PRIMEIRA linha de cada data: acrescentar outra
  // linha na mesma data faria a tela mostrar o saldo antigo.
  const insercoes = sql.match(/insert into public\.saldos_historico[\s\S]{0,320}?;/g) ?? [];
  assert.ok(insercoes.length >= 3, "a migration precisa gravar saldo nas duas pontas e no estorno");
  for (const insercao of insercoes) {
    assert.match(insercao, /on conflict \(conta_id, data_saldo\)\s*\n?\s*do update set valor_saldo = excluded\.valor_saldo/);
  }
});

// ---------------------------------------------------------------------------
// 8. Estorno
// ---------------------------------------------------------------------------

test("estorno devolve os valores e preserva a transferência original", async () => {
  const sql = await read(MIGRATION);
  const corpo = corpoDaFuncao(sql, "estornar_transferencia");
  // Motivo obrigatório.
  assert.match(corpo, /Informe o motivo do estorno\./);
  // Movimento inverso e original preservada, nunca apagada.
  assert.match(corpo, /set status = 'estornada'/);
  assert.match(corpo, /'preservada', true/);
  assert.doesNotMatch(corpo, /delete from/i);
  // Dois eventos: o estorno e a movimentação inversa.
  assert.match(corpo, /'estornou'/);
  assert.match(corpo, /'transferiu'/);
  assert.match(corpo, /DOIS eventos/);
  // Idempotente também no estorno.
  assert.match(corpo, /'estorno:' \|\| p_transferencia_id::text/);
  assert.match(corpo, /ja_estornada/);

  const transporte = await read("src/lib/transferenciasContas.js");
  assert.match(transporte, /if \(!String\(note \?\? ""\)\.trim\(\)\) throw new Error\("Informe o motivo do estorno\."\)/);
});

// ---------------------------------------------------------------------------
// 7. Segregação por secretaria
// ---------------------------------------------------------------------------

test("Finanças pode transferir para Saúde, Educação e Assistência Social", () => {
  const financas = conta(1, 100000, 1, "SECRETARIA MUNICIPAL DE FINANÇAS");
  for (const [id, nome] of [[2, "SECRETARIA MUNICIPAL DE SAÚDE"], [3, "SECRETARIA DE EDUCAÇÃO"], [4, "SEC. DE ASSISTÊNCIA SOCIAL"]]) {
    const destino = conta(10 + id, 0, id, nome);
    assert.equal(transferenciaPermitida(financas, destino), true, nome);
    assert.equal(motivoBloqueioTransferencia(financas, destino), null, nome);
  }
  // Acento, caixa e abreviação não mudam a resposta.
  assert.equal(transferenciaPermitida(conta(1, 1, 1, "financas"), conta(2, 0, 2, "saude")), true);
});

test("transferência entre quaisquer outras secretarias é bloqueada", () => {
  const saude = conta(1, 100000, 2, "SECRETARIA MUNICIPAL DE SAÚDE");
  const educacao = conta(2, 0, 3, "SECRETARIA DE EDUCAÇÃO");
  assert.equal(transferenciaPermitida(saude, educacao), false);
  assert.match(motivoBloqueioTransferencia(saude, educacao), /não é permitida/);
  // Saúde não vira Finanças por transferir para Finanças.
  assert.equal(transferenciaPermitida(saude, conta(3, 0, 1, "SECRETARIA DE FINANÇAS")), false);
  // Mesma secretaria continua livre.
  assert.equal(transferenciaPermitida(saude, conta(4, 0, 2, "SECRETARIA MUNICIPAL DE SAÚDE")), true);

  // A conferência do painel recusa a linha bloqueada antes de confirmar.
  const conferencia = conferirTransferenciaMultipla({ destino: educacao, origens: [{ conta: saude, valor: 1000 }] });
  assert.equal(conferencia.podeConfirmar, false);

  // A tela só oferece as secretarias que podem trocar com a atual.
  const secretarias = [
    { id: 1, nome: "SECRETARIA DE FINANÇAS" },
    { id: 2, nome: "SECRETARIA DE SAÚDE" },
    { id: 3, nome: "SECRETARIA DE EDUCAÇÃO" },
    { id: 5, nome: "SECRETARIA DE OBRAS" },
  ];
  assert.deepEqual(secretariasRelacionadas({ id: 5, nome: "SECRETARIA DE OBRAS" }, secretarias), ["5"]);
  assert.deepEqual(secretariasRelacionadas({ id: 1, nome: "SECRETARIA DE FINANÇAS" }, secretarias).sort(), ["1", "2", "3"]);
});

test("a mesma regra de segregação está no banco, que é quem barra de verdade", async () => {
  const sql = await read(MIGRATION);
  const corpo = corpoDaFuncao(sql, "transferencia_entre_secretarias_permitida");
  assert.match(corpo, /like '%financ%'/);
  assert.match(corpo, /like '%saude%'/);
  assert.match(corpo, /like '%educac%'/);
  assert.match(corpo, /like '%assist%'/);
  const confirmacao = corpoDaFuncao(sql, "confirmar_transferencias_programacao");
  assert.match(confirmacao, /transferencia_entre_secretarias_permitida/);
});

// ---------------------------------------------------------------------------
// 10 e 11. Histórico, auditoria e permissões
// ---------------------------------------------------------------------------

test("histórico e auditoria recebem data, contas, valor, usuário, identificador e saldos", async () => {
  const sql = await read(MIGRATION);
  const confirmacao = corpoDaFuncao(sql, "confirmar_transferencias_programacao");
  for (const campo of [
    "'chave_idempotencia'",
    "'programacao_id'",
    "'conta_destino_id'",
    "'valor_total'",
    "'saldo_destino_antes'",
    "'saldo_destino_depois'",
    "'observacao'",
  ]) assert.ok(confirmacao.includes(campo), "campo ausente na auditoria: " + campo);
  assert.match(confirmacao, /'pagamentos',\s*\n?\s*'transferiu'/);
  assert.match(confirmacao, /'critico'/);
  // Saldo antes e depois de cada conta ficam também na razão.
  assert.match(sql, /saldo_origem_antes/);
  assert.match(sql, /saldo_origem_depois/);
  // Nível só com os valores aceitos pela restrição da tabela.
  assert.doesNotMatch(sql, /,\s*'normal'\s*\)/);
});

test("as cinco permissões da fase entram na matriz sem tirar acesso de ninguém", async () => {
  const [especiais, aba, dados, sql] = await Promise.all([
    read("src/lib/permissoesEspeciais.js"),
    read("src/components/equipe/AbaPermissoes.jsx"),
    read("src/lib/execucaoProgramacaoDados.js"),
    read(MIGRATION),
  ]);
  for (const acao of [
    "aprovar_programacao",
    "executar_programacao",
    "definir_conta_pagamento",
    "executar_transferencia",
    "estornar_transferencia",
  ]) {
    assert.match(especiais, new RegExp(`id: "${acao}"`), "ação ausente na matriz: " + acao);
    assert.match(dados, new RegExp(acao));
    assert.match(sql, new RegExp(acao));
  }
  // Padrão da matriz vem da permissão do módulo: ninguém perde acesso.
  assert.match(aba, /aprovar_programacao: pagamentos\.pode_aprovar === true/);
  assert.match(aba, /definir_conta_pagamento: pagamentos\.pode_editar === true/);
  const corpo = corpoDaFuncao(sql, "pode_em_pagamentos_fase2");
  assert.match(corpo, /permissoes_especiais/);
  assert.match(corpo, /pode_aprovar/);
});

// ---------------------------------------------------------------------------
// 9, 16 e 17. Saldos, tela sem migration e não regressão
// ---------------------------------------------------------------------------

test("Saldos das Contas reflete a transferência na hora, pela mesma fonte de saldo", async () => {
  const pagina = await read(PAGINA);
  assert.match(pagina, /async function aposMovimentoDeSaldo/);
  assert.match(pagina, /await carregarBase\(\);/);
  assert.match(pagina, /onConcluida=\{\(\) => aposMovimentoDeSaldo\(/);
  assert.match(pagina, /onConcluido=\{\(\) => aposMovimentoDeSaldo\(/);
  // A tela lê o saldo pela rotina compartilhada com a aba Saldos das Contas.
  assert.match(pagina, /carregarSaldosDasContas/);
  const dados = await read("src/lib/execucaoProgramacaoDados.js");
  assert.match(dados, /carregarSaldosDasContas/);
});

test("a tela funciona antes de a migration rodar, avisando em vez de quebrar", async () => {
  const [pagina, estrutura] = await Promise.all([read(PAGINA), read("src/lib/estruturaPagamentosFase2.js")]);
  assert.match(pagina, /20260828140000_execucao_financeira_fase_2\.sql/);
  assert.match(pagina, /Estrutura da execução financeira \(Fase 2\) incompleta/);
  assert.match(pagina, /SQL Editor do mesmo projeto Supabase usado pela aplicação/);
  // A leitura da coluna nova é tolerante: falta de coluna não derruba a tela.
  assert.match(pagina, /async function contasDefinidasDosPagamentos/);
  assert.match(pagina, /return new Map\(\);/);
  // Sonda sem trazer linha: RLS restritiva não é confundida com falta de estrutura.
  assert.match(estrutura, /\.limit\(0\)/);
  assert.match(estrutura, /naoVerificado/);
});

test("migration da fase 2 é única, idempotente, aditiva e valida os tipos antes do DDL", async () => {
  const sql = await read(MIGRATION);
  assert.match(sql, /^-- FASE 2/);
  assert.match(sql, /rodada MANUALMENTE no SQL Editor/);
  assert.match(sql, /^begin;/m);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /create table if not exists public\.transferencia_lotes/);
  assert.match(sql, /create table if not exists public\.transferencias_contas/);
  assert.match(sql, /add column if not exists aprovada_em/);
  assert.match(sql, /add column if not exists conta_origem_id/);
  assert.match(sql, /create unique index if not exists/);
  // Nada de destrutivo e nada agendado.
  assert.doesNotMatch(sql, /delete from|drop table|drop function|truncate\s+(table\s+)?public\./i);
  // O direito de apagar a razão das transferências é retirado de quem usa a tela.
  assert.match(sql, /revoke insert, update, delete, truncate on public\.transferencias_contas from authenticated;/);
  assert.doesNotMatch(sql, /schedule\s*:|cron\s*\(/i);
  // Tipos reais conferidos antes da primeira alteração de estrutura.
  const validacao = sql.slice(0, sql.indexOf("alter table"));
  for (const trecho of [
    "('contas_bancarias', 'id', 'integer')",
    "('fornecedores', 'id', 'integer')",
    "('usuarios', 'id', 'uuid')",
    "('programacoes_pagamento', 'id', 'integer')",
    "('pagamentos', 'id', 'integer')",
    "('pagamento_movimentacoes', 'id', 'uuid')",
    "('saldos_historico', 'id', 'bigint')",
  ]) assert.match(validacao, new RegExp(trecho.replace(/[()]/g, "\\$&")));
  // A armadilha do %rowtype na mesma lista INTO continua fora.
  assert.doesNotMatch(sql, /%rowtype\s*,/i);
});

test("a fase 1 continua inteira na tela: nada do planejamento foi trocado pela execução", async () => {
  const pagina = await read(PAGINA);
  for (const marca of [
    /Selecionar todas/,
    /CONFIRMAR CONTAS/,
    /ALTERAR CONTAS/,
    /CONFIRMAR FORNECEDORES/,
    /ALTERAR FORNECEDORES/,
    /Adicionar fornecedor avulso/,
    /Cadastrar posteriormente como fornecedor/,
    /Marcar em análise/,
    /Imprimir programação para análise/,
    /onClick=\{gerarPdf\}/,
    /onClick=\{exportarExcel\}/,
    /SALDO TOTAL DA PROGRAMAÇÃO/,
    /salvar_planejamento_programacao/,
  ]) assert.match(pagina, marca);
  // A etapa nova só aparece depois da aprovação e não substitui o planejamento.
  assert.match(pagina, /\{emEtapaDeExecucao && <div className="mt-3 print:hidden">/);
  assert.match(pagina, /APROVAR PROGRAMAÇÃO/);
});
