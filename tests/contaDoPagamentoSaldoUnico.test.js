// Testes obrigatórios de duas correções da programação diária:
//
//   1. O SALDO CONGELADO VALE NA PROGRAMAÇÃO INTEIRA -> contas de trabalho,
//      seletor "Conta para atribuição", coluna "Conta do pagamento", resumo por
//      conta, impressão e PDF saem TODOS da mesma lista de contas. Numa
//      programação de data anterior, aprovada ou fechada, esse valor é o saldo
//      considerado quando ela foi montada; na programação do dia, em
//      elaboração, continua sendo o saldo atual. A mesma conta não pode
//      aparecer com um número no topo da tela e outro embaixo.
//   2. DEFINIR A CONTA DO PAGAMENTO FUNCIONA E NÃO FICA EM SILÊNCIO -> atribuir
//      aos selecionados, aplicar a todos e a escolha individual gravam; a
//      gravação é reconferida no banco antes de o contador mudar; e quando a
//      atribuição não pode ser aplicada, o botão fica desabilitado com a RAZÃO
//      escrita na tela em vez de não fazer nada quando clicado.
//
// A trava que continua valendo em cima de tudo isto:
//
//   ATRIBUIR CONTA NÃO DEBITA CONTA -> conta selecionada ≠ conta debitada.
//   PROGRAMADO ≠ PAGO. APROVADO ≠ PAGO. TRANSFERÊNCIA NÃO É DESPESA.
//   SEM REGISTRO NÃO É ZERO -> conta sem saldo gravado aparece "--" e não é
//     acusada de saldo insuficiente, porque não há valor para comparar.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  MOTIVO_ESTRUTURA_AUSENTE,
  MOTIVO_GRAVANDO,
  MOTIVO_SEM_CONTAS,
  MOTIVO_SEM_CONTA_ESCOLHIDA,
  MOTIVO_SEM_FORNECEDORES,
  MOTIVO_SEM_MARCADOS,
  MOTIVO_SEM_PERMISSAO_CONTA,
  MOTIVO_SEM_PERMISSAO_EXECUCAO,
  aplicarContaEmPagamentos,
  aplicarContaEmTodos,
  contasAtribuiveis,
  motivoAtribuicaoEmLote,
  motivoContaIndisponivel,
  resumoExecucao,
} from "../src/lib/execucaoProgramacao.js";
import {
  TEXTO_SEM_REGISTRO,
  aplicarSaldosCongelados,
  mapaSaldosCongelados,
  somarSaldosCongelados,
  usaSaldoCongelado,
} from "../src/lib/saldoCongeladoProgramacao.js";
import { contasSelecionadasDaLista } from "../src/lib/contasBancariasBusca.js";
import { formatBRL } from "../src/lib/moeda.js";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const PAGINA = "src/pages/PagamentosRedesenhado.jsx";
const PAINEL = "src/components/pagamentos/PainelExecucaoProgramacao.jsx";
const MODAL_TRANSFERENCIA = "src/components/pagamentos/ModalTransferenciaEntreContas.jsx";
// A definição vigente de definir_conta_origem_pagamento: é ela que grava a
// coluna e é ela que precisa deixar o dado de pé depois de um F5.
const MIGRATION_CONTA = "supabase/migrations/20260828230000_diagnosticar_transferencia_entre_contas.sql";

const HOJE = "2026-09-09";

// O caso do comando: programação de 02/09, aprovada, com 15 fornecedores.
const PROGRAMACAO_ANTERIOR = { id: 90, data_programacao: "2026-09-02", status: "aprovada", fechado: false, secretaria_id: 3 };

// Saldos gravados quando a programação foi montada (programacao_contas).
const CONGELADAS = [
  { conta_id: 11, saldo_considerado: "180000.00", ordem: 1 },
  { conta_id: 12, saldo_considerado: "42350.75", ordem: 2 },
];

// Os saldos de HOJE das mesmas contas: nada disto pode aparecer na tela da
// programação de 02/09. A conta 13 entrou na programação sem saldo gravado.
const CONTAS_HOJE = [
  { id: 11, nome_conta: "FUNDEB", numero_conta: "2.042-7", banco: "BB", secretaria: "EDUCAÇÃO", secretaria_id: 3, saldo: 5000, saldoDisponivel: 5000 },
  { id: 12, nome_conta: "MERENDA", numero_conta: "1.001-9", banco: "CAIXA", secretaria: "EDUCAÇÃO", secretaria_id: 3, saldo: 990000, saldoDisponivel: 990000 },
  { id: 13, nome_conta: "TRANSPORTE", numero_conta: "3.300-1", banco: "BB", secretaria: "EDUCAÇÃO", secretaria_id: 3, saldo: 77000, saldoDisponivel: 77000 },
];

const SELECIONADAS = new Set([11, 12, 13]);

/** Os 15 fornecedores do relato, nenhum com conta definida. */
const quinzeFornecedores = () =>
  Array.from({ length: 15 }, (_, indice) => ({
    id: 500 + indice,
    fornecedor_id: 700 + indice,
    valor_a_pagar: 1000 + indice,
    conta_origem_id: null,
  }));

/** A lista de contas como a tela monta para a programação inteira. */
const contasDaProgramacao = (programacao, contas = CONTAS_HOJE, linhas = CONGELADAS) =>
  usaSaldoCongelado({ programacao, hoje: HOJE })
    ? aplicarSaldosCongelados(contas, { saldos: mapaSaldosCongelados(linhas) })
    : contas;

// ---------------------------------------------------------------------------
// TESTE 1: escolher a conta, marcar vários e "Atribuir conta aos selecionados"
// ---------------------------------------------------------------------------

test("TESTE 1: conta escolhida + 15 marcados: atribuir aos selecionados aplica e o contador vira 15 de 15", () => {
  const contas = contasDaProgramacao(PROGRAMACAO_ANTERIOR);
  const disponiveis = contasAtribuiveis({ contas, contasSelecionadas: SELECIONADAS, secretariaId: 3 });
  assert.equal(disponiveis.length, 3, "as três contas de trabalho da secretaria ficam atribuíveis");

  let pagamentos = quinzeFornecedores();
  const antes = resumoExecucao(pagamentos, disponiveis);
  assert.equal(antes.comConta, 0);
  assert.equal(antes.semConta, 15, "é o estado relatado: SEM CONTA DEFINIDA: 15");

  // Sem conta escolhida o botão não é um clique perdido: ele diz o que falta.
  assert.equal(
    motivoAtribuicaoEmLote({
      escopo: "selecionados",
      totalPagamentos: 15,
      quantidadeMarcada: 15,
      contaEscolhida: null,
      contasDisponiveis: disponiveis.length,
    }),
    MOTIVO_SEM_CONTA_ESCOLHIDA
  );

  // Com a conta escolhida e os 15 marcados, não há impedimento nenhum.
  const marcados = pagamentos.map((item) => item.id);
  assert.equal(
    motivoAtribuicaoEmLote({
      escopo: "selecionados",
      totalPagamentos: 15,
      quantidadeMarcada: marcados.length,
      contaEscolhida: 11,
      contasDisponiveis: disponiveis.length,
    }),
    ""
  );

  pagamentos = aplicarContaEmPagamentos(pagamentos, marcados, 11);
  const depois = resumoExecucao(pagamentos, disponiveis);
  assert.equal(depois.comConta, 15, "COM CONTA DEFINIDA: 15 de 15");
  assert.equal(depois.semConta, 0, "SEM CONTA DEFINIDA: 0");
  assert.ok(pagamentos.every((item) => item.conta_origem_id === 11), "todas as linhas mostram a conta");
  // ATRIBUIR CONTA NÃO DEBITA CONTA: o saldo exibido da conta 11 é o mesmo.
  const distribuicao = depois.distribuicao.find((item) => item.contaId === 11);
  assert.equal(distribuicao.saldo, 180000, "continua o saldo considerado, sem desconto nenhum");
});

test("TESTE 2: aplicar conta a todos atinge os 15 sem precisar de marcação", () => {
  const contas = contasDaProgramacao(PROGRAMACAO_ANTERIOR);
  const disponiveis = contasAtribuiveis({ contas, contasSelecionadas: SELECIONADAS, secretariaId: 3 });
  // "Aplicar a todos" não exige fornecedor marcado -- exige conta escolhida.
  const comum = { totalPagamentos: 15, contasDisponiveis: disponiveis.length };
  assert.equal(motivoAtribuicaoEmLote({ escopo: "todos", ...comum, contaEscolhida: null }), MOTIVO_SEM_CONTA_ESCOLHIDA);
  assert.equal(motivoAtribuicaoEmLote({ escopo: "todos", ...comum, quantidadeMarcada: 0, contaEscolhida: 12 }), "");

  const pagamentos = aplicarContaEmTodos(quinzeFornecedores(), 12);
  const resumo = resumoExecucao(pagamentos, disponiveis);
  assert.equal(resumo.comConta, 15);
  assert.equal(resumo.semConta, 0);
  assert.equal(resumo.distribuicao.length, 1);
  assert.equal(resumo.distribuicao[0].contaId, 12);
});

test("TESTE 3: a conta de um único fornecedor pode ser definida e trocada", () => {
  const contas = contasDaProgramacao(PROGRAMACAO_ANTERIOR);
  const disponiveis = contasAtribuiveis({ contas, contasSelecionadas: SELECIONADAS, secretariaId: 3 });
  // A escolha individual não depende do seletor de lote: não há conta escolhida
  // no lote e ela continua liberada.
  assert.equal(motivoContaIndisponivel({ contasDisponiveis: disponiveis.length }), "");

  let pagamentos = aplicarContaEmTodos(quinzeFornecedores(), 11);
  pagamentos = aplicarContaEmPagamentos(pagamentos, [507], 12);
  assert.equal(pagamentos.find((item) => item.id === 507).conta_origem_id, 12);
  assert.equal(pagamentos.filter((item) => item.conta_origem_id === 11).length, 14);
  const resumo = resumoExecucao(pagamentos, disponiveis);
  assert.equal(resumo.comConta, 15, "a troca individual não desfaz o lote");
  // Retirar a conta de um pagamento é possível e não movimenta nada.
  pagamentos = aplicarContaEmPagamentos(pagamentos, [507], null);
  assert.equal(resumoExecucao(pagamentos, disponiveis).semConta, 1);
});

test("TESTE 4: a conta definida sobrevive ao F5, porque a tela reconfere no banco", async () => {
  const pagina = await read(PAGINA);
  // A gravação chama a função do banco...
  assert.match(pagina, /await definirContaDePagamentos\(\{\n\s*programacaoId: idProgramacao,\n\s*pagamentoIds: alvos,\n\s*contaId: conta,\n\s*\}\)/);
  // ...e imediatamente RELÊ do banco a conta de cada pagamento, em vez de
  // acreditar na tela: é o que faz o contador refletir o que um F5 mostraria.
  assert.match(pagina, /const gravadas = await contasDefinidasDosPagamentos\(idProgramacao\)/);
  assert.match(pagina, /conta_origem_id: gravadas\.get\(String\(item\.id\)\)/);
  // Se o banco não confirmar, a tela diz isso em vez de mostrar sucesso falso.
  assert.match(pagina, /O banco não confirmou a conta em \$\{naoConfirmados\.length\} de \$\{alvos\.length\} pagamentos/);
  assert.match(pagina, /Nenhum saldo foi movimentado/);
  // E a gravação devolve o resultado para o painel mostrar ao lado do botão.
  assert.match(pagina, /return \{ ok: true, mensagem: feito \}/);
  assert.match(pagina, /return \{ ok: false, mensagem: recusa \}/);
  // Abrir a programação (o F5) monta cada pagamento com a conta lida do banco.
  assert.match(pagina, /const contaPorPagamento = await contasDefinidasDosPagamentos\(idProgramacao\)/);
  assert.match(pagina, /conta_origem_id: contaPorPagamento\.get\(String\(item\.id\)\) \?\? null/);

  // No banco, a coluna gravada é a do pagamento, e a função recusa em voz alta
  // quando nenhuma linha corresponde -- silêncio nunca passa por sucesso.
  const sql = await read(MIGRATION_CONTA);
  assert.match(sql, /update public\.pagamentos p\n\s*set conta_origem_id = p_conta_id/);
  assert.match(sql, /if v_atualizados = 0 then\n\s*raise exception 'Nenhum pagamento desta programação corresponde à seleção\.'/);
  // E continua sendo só o vínculo: nenhuma movimentação de saldo aqui.
  assert.match(sql, /Grava SÓ o vínculo\. Nenhuma linha de saldo, nenhuma movimentação\./);
  assert.match(sql, /'debitou_conta', false/);
});

test("TESTE 5: numa programação de data anterior o saldo exibido é o mesmo em todas as seções", async () => {
  assert.equal(usaSaldoCongelado({ programacao: PROGRAMACAO_ANTERIOR, hoje: HOJE }), true);
  const contas = contasDaProgramacao(PROGRAMACAO_ANTERIOR);

  // Seção "Contas de trabalho".
  const trabalho = contasSelecionadasDaLista(contas, SELECIONADAS);
  assert.deepEqual(trabalho.map((linha) => linha.saldo), [180000, 42350.75, null]);
  // Total exibido = soma do que está exibido.
  assert.equal(somarSaldosCongelados(trabalho), 222350.75);

  // Seção "Execução da programação": seletor de atribuição e coluna da conta.
  const disponiveis = contasAtribuiveis({ contas, contasSelecionadas: SELECIONADAS, secretariaId: 3 });
  assert.deepEqual(disponiveis.map((conta) => conta.saldo), [180000, 42350.75, null]);
  // Nenhum saldo de hoje sobrou em lugar nenhum da lista da execução.
  for (const conta of disponiveis) {
    const hoje = CONTAS_HOJE.find((item) => item.id === conta.id);
    assert.notEqual(conta.saldo, hoje.saldo, `a conta ${conta.id} não mostra o saldo de hoje`);
    assert.equal(conta.saldoDisponivel, conta.saldo, "quem lê 'saldo ou disponível' também vê o congelado");
  }

  // Resumo por conta da execução: os mesmos números, conta por conta.
  const pagamentos = [
    { id: 1, valor_a_pagar: 1000, conta_origem_id: 11 },
    { id: 2, valor_a_pagar: 2000, conta_origem_id: 12 },
    { id: 3, valor_a_pagar: 3000, conta_origem_id: 13 },
  ];
  const resumo = resumoExecucao(pagamentos, disponiveis);
  const porConta = new Map(resumo.distribuicao.map((item) => [item.contaId, item]));
  assert.equal(porConta.get(11).saldo, 180000);
  assert.equal(porConta.get(12).saldo, 42350.75);
  // SEM REGISTRO NÃO É ZERO: a conta 13 não vira R$ 0,00 nem herda os 77.000 de
  // hoje, e por isso não é acusada de saldo insuficiente.
  assert.equal(porConta.get(13).saldo, null);
  assert.equal(porConta.get(13).saldoRegistrado, false);
  assert.equal(porConta.get(13).acimaDoSaldo, false);
  assert.equal(porConta.get(13).saldoAposPagamentos, null);

  // A programação do dia, em elaboração, continua com o saldo de hoje.
  const doDia = { id: 91, data_programacao: HOJE, status: "em_elaboracao", fechado: false, secretaria_id: 3 };
  assert.equal(usaSaldoCongelado({ programacao: doDia, hoje: HOJE }), false);
  const hoje = contasAtribuiveis({
    contas: contasDaProgramacao(doDia),
    contasSelecionadas: SELECIONADAS,
    secretariaId: 3,
  });
  assert.deepEqual(hoje.map((conta) => conta.saldo), [5000, 990000, 77000]);

  // E na tela: a execução recebe a MESMA lista das contas de trabalho.
  const pagina = await read(PAGINA);
  assert.match(pagina, /<PainelExecucaoProgramacao\n\s*programacao=\{programacao\}\n\s*pagamentos=\{pagamentosOrdenados\}\n\s*contas=\{contasDaProgramacao\}/);
  assert.match(pagina, /saldoCongelado=\{modoSaldoCongelado\}/);
  assert.match(pagina, /dataFormatada=\{dataBR\(programacao\.data_programacao\)\}/);

  const painel = await read(PAINEL);
  // O painel não tem fonte de saldo própria: tudo sai de `contas`/`disponiveis`.
  assert.match(painel, /const disponiveis = contasAtribuiveis\(\{ contas, contasSelecionadas, secretariaId \}\)/);
  assert.match(painel, /const resumo = resumoExecucao\(pagamentos, disponiveis\)/);
  assert.match(painel, /<SeletorContas\n\s*className="mt-1"\n\s*contas=\{disponiveis\}/);
  assert.doesNotMatch(painel, /carregarSaldosDasContas|saldoAtual|saldosDeHoje/);
  // Ausência de valor aparece "--" no seletor, na coluna e no resumo.
  assert.match(painel, /const textoSaldo = \(valor\) => \(valor == null \? TEXTO_SEM_REGISTRO : formatBRL\(valor\)\)/);
  assert.match(painel, /\{conta\.nome_conta\} · saldo \{textoSaldo\(conta\.saldo \?\? null\)\}/);
  assert.match(painel, /\{formatBRL\(item\.total\)\} de \{textoSaldo\(item\.saldo\)\}/);
  assert.equal(TEXTO_SEM_REGISTRO, "--");
  assert.equal(formatBRL(0).includes(TEXTO_SEM_REGISTRO), false, '"--" nunca se confunde com R$ 0,00');
});

test("TESTE 6: salvar, aprovar e a trava da fase continuam de pé", async () => {
  const pagina = await read(PAGINA);
  assert.match(pagina, /supabase\.rpc\("salvar_planejamento_programacao", argumentos\)/);
  assert.match(pagina, /await aprovarProgramacao\(\{/);
  assert.match(pagina, /saldo_considerado: numero\(saldoParaGravar\(\{ conta, modoCongelado: modoSaldoCongelado \}\)\)/);
  // Definir a conta não movimenta saldo: a gravação chama só a função do
  // vínculo, e nenhuma escrita de saldo entra nesse caminho.
  const bloco = pagina.slice(
    pagina.indexOf("async function gravarContaDosPagamentos"),
    pagina.indexOf("async function garantirContasDeTransferencia")
  );
  assert.ok(bloco.length > 0);
  assert.doesNotMatch(bloco, /saldos_historico|registrarSaldo|confirmarTransferencias|dar_baixa|baixa/i);
  assert.match(bloco, /Definir conta não debita conta\./);
});

// ---------------------------------------------------------------------------
// Nenhum botão em silêncio: a razão de cada bloqueio, na tela
// ---------------------------------------------------------------------------

test("cada impedimento da atribuição tem uma razão escrita, e a ordem delas é a útil", () => {
  // Estrutura ausente vem antes de tudo: é o que explica a tela inteira parada.
  assert.equal(
    motivoContaIndisponivel({ estruturaAusente: true, podeDefinirConta: false, contasDisponiveis: 0 }),
    MOTIVO_ESTRUTURA_AUSENTE
  );
  assert.equal(motivoContaIndisponivel({ podeDefinirConta: false, contasDisponiveis: 3 }), MOTIVO_SEM_PERMISSAO_CONTA);
  // A permissão que faltava e não aparecia em lugar nenhum: executar a
  // programação também libera definir a conta. A regra não muda -- ela passa a
  // ser dita com o nome dela.
  assert.equal(motivoContaIndisponivel({ podeExecutar: false, contasDisponiveis: 3 }), MOTIVO_SEM_PERMISSAO_EXECUCAO);
  assert.equal(motivoContaIndisponivel({ contasDisponiveis: 0 }), MOTIVO_SEM_CONTAS);
  assert.equal(motivoContaIndisponivel({ contasDisponiveis: 3, salvando: true }), MOTIVO_GRAVANDO);
  assert.equal(motivoContaIndisponivel({ contasDisponiveis: 3 }), "");

  const comum = { contasDisponiveis: 3 };
  assert.equal(motivoAtribuicaoEmLote({ ...comum, totalPagamentos: 0, contaEscolhida: 11 }), MOTIVO_SEM_FORNECEDORES);
  assert.equal(motivoAtribuicaoEmLote({ ...comum, totalPagamentos: 15, contaEscolhida: 11, quantidadeMarcada: 0 }), MOTIVO_SEM_MARCADOS);
  assert.match(MOTIVO_SEM_CONTA_ESCOLHIDA, /Conta para atribuição/, "a razão aponta o campo da tela pelo nome");
});

test("a escolha da conta é conferida contra a lista atribuível, mesmo com id em texto", () => {
  // O id vinha do <select> como texto e a conferência era por identidade: uma
  // conta escolhida podia sumir da lista e a atribuição virava um clique morto.
  const contas = [{ id: 11, nome_conta: "FUNDEB", secretaria_id: 3, saldo: 100 }];
  assert.equal(contasAtribuiveis({ contas, contasSelecionadas: new Set(["11"]), secretariaId: 3 }).length, 1);
  assert.equal(contasAtribuiveis({ contas, contasSelecionadas: new Set([11]), secretariaId: "3" }).length, 1);
  assert.equal(contasAtribuiveis({ contas, contasSelecionadas: new Set([99]), secretariaId: 3 }).length, 0);
});

test("os botões da atribuição mostram o motivo do bloqueio e a resposta da gravação", async () => {
  const painel = await read(PAINEL);
  // Desabilitado sempre acompanhado do motivo, no título e na tela.
  assert.match(painel, /disabled=\{motivoSelecionados !== ""\}/);
  assert.match(painel, /title=\{motivoSelecionados \|\| "Atribuir a conta escolhida aos fornecedores marcados\. Não debita nada\."\}/);
  assert.match(painel, /disabled=\{motivoTodos !== ""\}/);
  assert.match(painel, /aria-describedby="motivo-atribuir-selecionados"/);
  assert.match(painel, /aria-describedby="motivo-aplicar-a-todos"/);
  assert.match(painel, /<p id="motivo-atribuir-selecionados" role="status"/);
  assert.match(painel, /<p id="motivo-aplicar-a-todos" role="status"/);
  assert.match(painel, /disabled=\{motivoIndividual !== ""\}/);
  assert.match(painel, /A conta de cada pagamento não pode ser definida agora: \{motivoIndividual\}/);
  // A conta escolhida aparece por extenso: era o que faltava para conferir na
  // tela o que a lista registrou.
  assert.match(painel, /rotulo="Conta escolhida para atribuição"/);
  assert.match(painel, /Nenhuma conta escolhida ainda/);
  // A resposta da gravação aparece DENTRO da seção, junto do botão clicado.
  assert.match(painel, /\{resposta\?\.mensagem &&/);
  assert.match(painel, /resposta\.ok === false \? "bg-\[#FBE9DF\] text-\[#8A321C\]" : "bg-\[#E5EFEA\] text-\[#17352F\]"/);
  // Retorno possivelmente não-promessa não pode quebrar o clique.
  assert.match(painel, /Promise\.resolve\(onAplicarATodos\?\.\(Number\(contaEmLote\)\)\)\.then\(aoConcluir\)/);
  assert.match(painel, /Promise\.resolve\(onDefinirConta\?\.\(pagamento, e\.target\.value \? Number\(e\.target\.value\) : null\)\)\.then\(aoConcluir\)/);
  // E o texto da seção continua dizendo que definir conta não debita.
  assert.match(painel, /Definir a conta não debita nada/);
});

test("a transferência avisa que o saldo dela é o de hoje, porque ela move dinheiro", async () => {
  const pagina = await read(PAGINA);
  assert.match(pagina, /avisoSaldo=\{modoSaldoCongelado/);
  assert.match(pagina, /porque a transferência move dinheiro de verdade agora/);
  const modal = await read(MODAL_TRANSFERENCIA);
  assert.match(modal, /avisoSaldo = ""/);
  assert.match(modal, /\{avisoSaldo \? <p/);
  // A conferência da transferência continua exatamente a mesma regra.
  assert.match(modal, /conferirTransferenciaMultipla/);
});
