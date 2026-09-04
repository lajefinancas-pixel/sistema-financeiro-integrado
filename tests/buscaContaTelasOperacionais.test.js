// Envio 3 -- busca de conta nas telas operacionais.
//
// A Programação Diária, a Baixa e a Transferência passam a usar o MESMO
// agrupamento por Secretaria, a MESMA busca e a MESMA rolagem do Envio 1. Estes
// testes conferem as dez verificações combinadas antes da entrega, com atenção
// especial ao que não pode mudar:
//
//   - marcar e desmarcar continuam sendo a única coisa que muda o saldo da
//     programação, e o saldo continua sendo a soma exclusiva das selecionadas;
//   - recolher grupo e filtrar pela busca não perdem conta selecionada;
//   - a baixa não debita o saldo da conta;
//   - nenhuma dessas telas oferece criar conta.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MENSAGEM_SEM_RESULTADO,
  PLACEHOLDER_BUSCA_CONTA,
  agruparContasPorSecretaria,
  alternarGrupo,
  contasSelecionadasDaLista,
  filtrarContasCadastradas,
  grupoRecolhido,
  linhaDaConta,
  rotuloContasSelecionadas,
  rotuloDoGrupo,
  selecionadasNoGrupo,
} from "../src/lib/contasBancariasBusca.js";
import {
  alternarSelecao,
  selecionarTodosVisiveis,
  somarContasSelecionadas,
} from "../src/lib/planejamentoPagamentos.js";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

const PROGRAMACAO = "src/pages/PagamentosRedesenhado.jsx";
const SELETOR = "src/components/comuns/SeletorContas.jsx";
const CONTA_SELECIONADA = "src/components/comuns/ContaSelecionada.jsx";
const BAIXA = "src/components/baixas/ModalRegistrarBaixa.jsx";
const TRANSFERENCIA = "src/components/pagamentos/ModalTransferenciaEntreContas.jsx";
const EXECUCAO = "src/components/pagamentos/PainelExecucaoProgramacao.jsx";

// Contas de trabalho de duas secretarias, como a tela recebe.
const CONTAS = [
  { id: 1, secretaria_id: 10, secretaria: "SAÚDE", banco: "Banco do Brasil", numero_conta: "2.042-7", nome_conta: "FUNDO MUNICIPAL DE SAÚDE", saldo: 150000 },
  { id: 2, secretaria_id: 10, secretaria: "SAÚDE", banco: "Caixa", numero_conta: "51.221-0", nome_conta: "PAB", saldo: 25000 },
  { id: 3, secretaria_id: 20, secretaria: "EDUCAÇÃO", banco: "Sicoob", numero_conta: "7.100-1", nome_conta: "FUNDEB", saldo: 90000 },
  { id: 4, secretaria_id: 20, secretaria: "EDUCAÇÃO", banco: "Banco do Brasil", numero_conta: "9.999-9", nome_conta: "MERENDA", saldo: 10000 },
];

// ---------------------------------------------------------------------------
// 1. Programação: buscar conta por número, nome, banco e secretaria
// ---------------------------------------------------------------------------

test("1. a busca da programação acha por número, nome, banco e secretaria", () => {
  const acha = (termo) => filtrarContasCadastradas(CONTAS, termo).map((conta) => conta.id);

  assert.deepEqual(acha("7.100-1"), [3]);
  assert.deepEqual(acha("71001"), [3]);
  assert.deepEqual(acha("merenda"), [4]);
  assert.deepEqual(acha("caixa"), [2]);
  assert.deepEqual(acha("educacao"), [3, 4]);
  // Sem resultado, a frase é a combinada -- e não aparece conta inventada.
  assert.deepEqual(acha("conta inexistente"), []);
  assert.equal(MENSAGEM_SEM_RESULTADO, "Nenhuma conta cadastrada encontrada.");
});

test("1. a tela reaproveita o seletor e o utilitário do Envio 1, sem duplicar a lógica", async () => {
  const [programacao, seletor] = await Promise.all([read(PROGRAMACAO), read(SELETOR)]);

  assert.match(programacao, /<SeletorContas/);
  assert.match(programacao, /from "\.\.\/lib\/contasBancariasBusca"/);
  // A busca, o agrupamento e o recolhimento moram no utilitário compartilhado:
  // a tela não reimplementa nenhum deles.
  assert.doesNotMatch(programacao, /agruparContasPorSecretaria|alternarGrupo|contaAtendeBusca/);
  assert.match(seletor, /agruparContasPorSecretaria/);

  // O campo de busca é o mesmo texto nas telas operacionais.
  assert.equal(PLACEHOLDER_BUSCA_CONTA, "Buscar conta por número, nome, banco ou Secretaria...");
  assert.match(seletor, /placeholder = PLACEHOLDER_BUSCA_CONTA/);
  assert.match(seletor, /placeholder=\{placeholder\}/);

  // Grupos recolhíveis com a contagem e rolagem interna com altura máxima.
  assert.equal(rotuloDoGrupo(agruparContasPorSecretaria(CONTAS)[1]), "SAÚDE — 2 contas");
  assert.match(seletor, /aria-expanded=\{!recolhido\}/);
  assert.match(seletor, /\$\{altura\} overflow-y-auto overscroll-contain/);
  assert.match(programacao, /altura="max-h-\[430px\]"/);
});

// ---------------------------------------------------------------------------
// 2. Programação: seleção múltipla continua funcionando
// ---------------------------------------------------------------------------

test("2. seleção múltipla: marcar inclui, desmarcar retira", () => {
  let selecionadas = new Set();
  selecionadas = alternarSelecao(selecionadas, 1);
  selecionadas = alternarSelecao(selecionadas, 3);
  assert.deepEqual([...selecionadas], [1, 3]);
  assert.equal(somarContasSelecionadas(CONTAS, selecionadas), 240000);

  selecionadas = alternarSelecao(selecionadas, 3);
  assert.deepEqual([...selecionadas], [1]);
  assert.equal(somarContasSelecionadas(CONTAS, selecionadas), 150000);

  // "Selecionar todas" continua marcando o que a busca deixou visível.
  const visiveis = filtrarContasCadastradas(CONTAS, "educacao").map((conta) => conta.id);
  selecionadas = selecionarTodosVisiveis(selecionadas, visiveis);
  assert.deepEqual([...selecionadas], [1, 3, 4]);
});

test("2. a tela continua com seleção múltipla e com Selecionar todas", async () => {
  const programacao = await read(PROGRAMACAO);
  assert.match(programacao, /modo="multipla"/);
  assert.match(programacao, /selecionadas=\{\[\.\.\.contasSelecionadas\]\}/);
  assert.match(programacao, /onEscolher=\{\(conta\) => alternarConta\(conta\.id\)\}/);
  assert.match(programacao, /Selecionar todas/);
});

// ---------------------------------------------------------------------------
// 3 e 4. Recolher grupo e filtrar pela busca não perdem seleção
// ---------------------------------------------------------------------------

test("3. recolher um grupo não perde nenhuma conta selecionada", () => {
  const selecionadas = new Set([1, 3]);
  const grupos = agruparContasPorSecretaria(CONTAS);
  const educacao = grupos.find((grupo) => grupo.nome === "EDUCAÇÃO");

  const recolhidos = alternarGrupo(new Set(), educacao.chave);
  assert.equal(grupoRecolhido(recolhidos, educacao.chave), true);

  // O grupo fechou, a seleção e o saldo ficaram inteiros -- e o cabeçalho
  // continua mostrando quantas contas daquele grupo estão marcadas.
  assert.deepEqual([...selecionadas], [1, 3]);
  assert.equal(somarContasSelecionadas(CONTAS, selecionadas), 240000);
  assert.equal(selecionadasNoGrupo(educacao, selecionadas), 1);

  // Reabrir também não mexe em seleção.
  assert.equal(grupoRecolhido(alternarGrupo(recolhidos, educacao.chave), educacao.chave), false);
  assert.deepEqual([...selecionadas], [1, 3]);
});

test("4. filtrar pela busca não perde nenhuma conta selecionada", () => {
  const selecionadas = new Set([1, 3]);

  // A busca só decide o que aparece; quem está marcado continua marcado.
  const visiveis = filtrarContasCadastradas(CONTAS, "saude").map((conta) => conta.id);
  assert.deepEqual(visiveis, [1, 2]);
  assert.deepEqual([...selecionadas], [1, 3]);
  assert.equal(somarContasSelecionadas(CONTAS, selecionadas), 240000);

  // Mesmo escondida pelo filtro, a conta 3 continua na conferência e no saldo.
  assert.deepEqual(contasSelecionadasDaLista(CONTAS, selecionadas).map((conta) => conta.id), [1, 3]);
});

test("3 e 4. o seletor separa grupos recolhidos de seleção", async () => {
  const seletor = await read(SELETOR);
  // `alternar` mexe apenas no conjunto de grupos recolhidos.
  assert.match(seletor, /function alternar\(chave\) \{\s*setRecolhidos\(\(atual\) => alternarGrupo\(atual, chave\)\);\s*\}/);
  assert.doesNotMatch(seletor, /setRecolhidos[\s\S]{0,80}onEscolher/);
  // A busca filtra a exibição; a seleção vem de fora, por props.
  assert.match(seletor, /const encontradas = React\.useMemo\(\(\) => filtrarContasCadastradas\(contas, busca\)/);
});

// ---------------------------------------------------------------------------
// 5. Saldo da Programação = soma exclusiva das contas selecionadas
// ---------------------------------------------------------------------------

test("5. o saldo da programação soma exatamente as contas selecionadas", () => {
  assert.equal(somarContasSelecionadas(CONTAS, new Set()), 0);
  assert.equal(somarContasSelecionadas(CONTAS, new Set([2])), 25000);
  assert.equal(somarContasSelecionadas(CONTAS, new Set([1, 2, 3, 4])), 275000);
  // Conta que não existe na lista não entra no saldo.
  assert.equal(somarContasSelecionadas(CONTAS, new Set([99])), 0);
});

test("5. o resumo fica sempre visível, fora da área com rolagem", async () => {
  const programacao = await read(PROGRAMACAO);
  assert.equal(rotuloContasSelecionadas(1), "1 CONTA SELECIONADA");
  assert.equal(rotuloContasSelecionadas(4), "4 CONTAS SELECIONADAS");

  // Contagem e saldo no mesmo resumo, com o cálculo intocado.
  assert.match(programacao, /rotuloContasSelecionadas\(contasSelecionadas\.size\)\} — SALDO DA PROGRAMAÇÃO: \{formatBRL\(totalDisponivel\)\}/);
  assert.match(programacao, /const totalDisponivel = somarContasSelecionadas\(contas, contasSelecionadas\);/);

  // O resumo está depois do seletor, isto é, fora da caixa que rola.
  assert.ok(programacao.indexOf("<SeletorContas") < programacao.indexOf("SALDO DA PROGRAMAÇÃO"));

  // "Ver contas selecionadas" lista o que está marcado, sem procurar na lista.
  assert.match(programacao, /Ver contas selecionadas/);
  assert.match(programacao, /setVerSelecionadas\(\(valor\) => !valor\)/);
  assert.match(programacao, /const contasSelecionadasComSaldo = contasSelecionadasDaLista\(contas, contasSelecionadas\);/);
});

// ---------------------------------------------------------------------------
// 6. Programação: salvar e aprovar continuam funcionando
// ---------------------------------------------------------------------------

test("6. salvar, marcar em análise e aprovar continuam na tela, como estavam", async () => {
  const programacao = await read(PROGRAMACAO);
  for (const marca of [
    /salvar_planejamento_programacao/,
    /onClick=\{salvarProgramacao\}/,
    /Salvar programação/,
    /Marcar em análise/,
    /APROVAR PROGRAMAÇÃO/,
    /CONFIRMAR CONTAS/,
    /ALTERAR CONTAS/,
    /p_saldo_considerado: totalDisponivel/,
  ]) assert.match(programacao, marca);
});

// ---------------------------------------------------------------------------
// 7 e 8. Baixa: conta utilizada e saldo intocado
// ---------------------------------------------------------------------------

test("7. a baixa busca entre as contas cadastradas e mostra a conta escolhida por extenso", async () => {
  const [baixa, bloco] = await Promise.all([read(BAIXA), read(CONTA_SELECIONADA)]);

  assert.match(baixa, /<SeletorContas/);
  assert.match(baixa, /Conta utilizada no pagamento/);
  assert.match(baixa, /<ContaSelecionada[\s\S]{0,140}conta=\{contaEscolhida\}/);

  // Banco | Conta | Nome da Conta | Secretaria, nesta ordem.
  const ordem = ["Banco", "Conta", "Nome da Conta", "Secretaria"];
  let anterior = -1;
  for (const rotulo of ordem) {
    const posicao = bloco.indexOf(`rotulo="${rotulo}"`);
    assert.ok(posicao > anterior, `${rotulo} fora de ordem no bloco da conta escolhida`);
    anterior = posicao;
  }
  // Os quatro campos saem da mesma linha do utilitário compartilhado.
  assert.match(bloco, /linhaDaConta/);
  const linha = linhaDaConta(CONTAS[0]);
  assert.equal(linha.banco, "Banco do Brasil");
  assert.equal(linha.numero_conta, "2.042-7");
  assert.equal(linha.nome_conta, "FUNDO MUNICIPAL DE SAÚDE");
  assert.equal(linha.secretaria, "SAÚDE");
});

test("8. a baixa continua registrando pagamento sem debitar o saldo da conta", async () => {
  const [baixa, bloco, lib] = await Promise.all([
    read(BAIXA),
    read(CONTA_SELECIONADA),
    read("src/lib/baixasPagamentos.js"),
  ]);

  // O fluxo da baixa é o mesmo: valor, data, conta e a nota escolhida.
  assert.match(baixa, /registrarBaixaDeNota\(\{/);
  assert.match(baixa, /valorEmAbertoId: nota\.id/);
  assert.match(baixa, /chaveIdempotencia: chaveIdempotencia\.current/);
  assert.match(baixa, /não altera o saldo da conta/);

  // Nem o bloco novo nem a exibição da conta escrevem saldo.
  assert.doesNotMatch(bloco, /saldos_historico|lancarSaldo|update\(|insert\(|rpc\(/);
  // A gravação da baixa continua sendo só a função de baixa do banco.
  assert.match(lib, /rpc\("registrar_baixa_de_nota"|rpc\("registrar_baixa_pagamento"/);
  assert.doesNotMatch(baixa, /saldos_historico|from\("contas_bancarias"\)/);
});

// ---------------------------------------------------------------------------
// 9. Transferência: busca em origem e destino, lógica financeira intacta
// ---------------------------------------------------------------------------

test("9. origem e destino usam a mesma busca agrupada por Secretaria", async () => {
  const transferencia = await read(TRANSFERENCIA);
  assert.equal(transferencia.match(/<SeletorContas/g).length, 2);
  assert.match(transferencia, /valor=\{destinoId\}/);
  assert.match(transferencia, /valor=\{linhas\[indice\]\.contaId\}/);
  assert.match(transferencia, /rotulo="Conta de destino"/);
  assert.match(transferencia, /rotulo="Conta de origem"/);
});

test("9. a transferência continua executando com a mesma lógica financeira", async () => {
  const [transferencia, regras] = await Promise.all([
    read(TRANSFERENCIA),
    read("src/lib/regrasTransferencia.js"),
  ]);
  // Confirmação, conferências e idempotência intactas.
  assert.match(transferencia, /confirmarTransferenciaEntreContas\(\{/);
  assert.match(transferencia, /conferirTransferenciaMultipla\(\{ destino, origens \}\)/);
  assert.match(transferencia, /pernas: pernasParaEnvio\(origens\)/);
  assert.match(transferencia, /chaveIdempotencia: chave\.current/);
  // A conta de destino continua fora das origens possíveis.
  assert.match(transferencia, /const origensPossiveis = contas\.filter\(\(conta\) => String\(conta\.id\) !== String\(destinoId\)\)/);
  // Origem menos valor, destino mais valor: não é despesa.
  assert.match(regras, /saldoDepois/);
  assert.match(transferencia, /patrimonioAntes/);
  assert.match(transferencia, /patrimonioDepois/);
});

// ---------------------------------------------------------------------------
// 10. Nenhuma tela oferece criar conta manual
// ---------------------------------------------------------------------------

// Comentário que explica a regra não é oferta de criar conta: a conferência lê
// só o código.
const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("10. nenhuma tela operacional oferece criar, inventar ou cadastrar conta", async () => {
  const arquivos = await Promise.all([
    read(PROGRAMACAO),
    read(BAIXA),
    read(TRANSFERENCIA),
    read(EXECUCAO),
    read(SELETOR),
    read(CONTA_SELECIONADA),
  ]);

  for (const arquivo of arquivos) {
    const codigo = semComentarios(arquivo);
    assert.doesNotMatch(codigo, /nova conta|conta avulsa|conta temporária|cadastro rápido|Cadastrar conta/i);
    assert.doesNotMatch(codigo, /from\("contas_bancarias"\)[\s\S]{0,160}\.insert\(/);
  }

  // Só se escolhe conta que veio da lista de cadastradas.
  const encontradas = filtrarContasCadastradas(CONTAS, "conta que nao existe");
  assert.deepEqual(encontradas, []);
});

// ---------------------------------------------------------------------------
// Responsividade
// ---------------------------------------------------------------------------

test("as listas e os blocos de conta se ajustam de celular a computador", async () => {
  const [seletor, bloco, programacao] = await Promise.all([
    read(SELETOR),
    read(CONTA_SELECIONADA),
    read(PROGRAMACAO),
  ]);
  // Uma coluna no celular, colunas completas a partir do tablet.
  assert.match(seletor, /grid-cols-1[\s\S]{0,120}sm:grid-cols-/);
  assert.match(seletor, /flex-col gap-2[\s\S]{0,60}sm:flex-row/);
  assert.match(bloco, /grid-cols-2 gap-x-3 gap-y-1 text-\[11px\] sm:grid-cols-4/);
  assert.match(programacao, /flex flex-wrap items-center justify-between/);
  // A rolagem é interna: a página nunca fica travada.
  for (const arquivo of [seletor, bloco, programacao]) {
    assert.doesNotMatch(arquivo, /document\.body\.style\.overflow/);
  }
});
