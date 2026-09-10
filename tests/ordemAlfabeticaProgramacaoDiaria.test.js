// Testes do envio "Ordem alfabética dos fornecedores na programação diária".
//
// A seção "2. Proposta" listava os fornecedores por maior valor em aberto. A
// ordem PADRÃO passa a ser ALFABÉTICA, em todos os pontos da programação: lista
// de seleção, lista dos escolhidos com os valores, tabela de contas da
// "Execução da programação", impressão, PDF e Excel.
//
// O que estes testes travam:
//
//   A ORDEM É PELO NOME EXIBIDO (nome de exibição da programação -> apelido ->
//   razão social), porque é esse o nome que a pessoa lê na tela
//   ALFABÉTICA BRASILEIRA: ACENTO E MAIÚSCULA NÃO MUDAM A POSIÇÃO
//   FORNECEDOR AVULSO ENTRA NA MESMA ORDEM, PELO NOME DIGITADO
//   REORDENAR É SÓ EXIBIÇÃO: VALOR, VÍNCULO, CONTA DEFINIDA E TOTAL FICAM IGUAIS
//   ACRESCENTAR FORNECEDOR NÃO MEXE NO QUE JÁ ESTAVA PREENCHIDO
//   A ORDEM DO PAPEL É A MESMA DA TELA
//   A ORDEM "MAIOR VALOR EM ABERTO" CONTINUA EXISTINDO NA BIBLIOTECA
//
// Não há regra de negócio nova aqui: a baixa continua não debitando conta,
// programado continua não sendo pago e aprovado continua não sendo pago.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  compararNomesExibidos,
  nomeExibicaoDoPagamento,
  ordenarFornecedoresPorNome,
  ordenarPagamentosPorNome,
} from "../src/lib/nomesFornecedor.js";
import {
  chavesDeExibicaoDosPagamentos,
  definirValorProgramado,
  ordenarFornecedoresPorAberto,
  somarPagamentos,
} from "../src/lib/planejamentoPagamentos.js";
import { htmlProgramacao, montarPlanilhaProgramacao } from "../src/lib/programacaoDocumento.js";
import { resumoExecucao } from "../src/lib/execucaoProgramacao.js";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

const PAGINA = "src/pages/PagamentosRedesenhado.jsx";

// Cadastros da secretaria, deliberadamente fora de ordem e com acento, caixa
// alta e apelido -- o caso real da tela.
const CADASTROS = [
  { id: 1, razao_social: "ZETA Serviços Ltda.", valor_em_aberto: 900000 },
  { id: 2, razao_social: "ÁVILA Materiais de Construção Ltda.", valor_em_aberto: 0 },
  { id: 3, razao_social: "José da Silva Comércio de Alimentos Ltda.", apelido: "Zé Alimentos", valor_em_aberto: 15000 },
  { id: 4, razao_social: "bahia distribuidora s/a", valor_em_aberto: 250000 },
  { id: 5, razao_social: "Cristal Papelaria ME", valor_em_aberto: 30.5 },
];

const nomes = (lista) => lista.map((item) => nomeExibicaoDoPagamento(item));

test("a lista de seleção da Proposta abre em ordem alfabética pelo nome exibido", () => {
  const ordenados = ordenarFornecedoresPorNome(CADASTROS);

  // "Ávila" antes de "bahia" (acento e caixa não contam) e o apelido
  // "Zé Alimentos" ordena pelo apelido, não pela razão social "José da Silva".
  assert.deepEqual(ordenados.map((item) => item.apelido ?? item.razao_social), [
    "ÁVILA Materiais de Construção Ltda.",
    "bahia distribuidora s/a",
    "Cristal Papelaria ME",
    "Zé Alimentos",
    "ZETA Serviços Ltda.",
  ]);

  // Ordenar é só exibição: os valores em aberto continuam exatamente os mesmos.
  assert.deepEqual(
    ordenados.map((item) => item.valor_em_aberto),
    [0, 250000, 30.5, 15000, 900000],
  );
  // E a lista recebida não foi mexida: a função devolve cópia.
  assert.equal(CADASTROS[0].razao_social, "ZETA Serviços Ltda.");
});

test("acento e maiúsculas/minúsculas não mudam a posição", () => {
  assert.ok(compararNomesExibidos("Ávila", "Bahia") < 0, "acento não joga o nome para o fim");
  assert.ok(compararNomesExibidos("ana", "Bahia") < 0, "minúscula não joga o nome para o fim");
  assert.ok(compararNomesExibidos("Zé Alimentos", "ZETA") < 0);
  // "ANA" e "Ana" ficam juntas: nada entra entre elas.
  const juntas = ordenarPagamentosPorNome([
    { id: 1, nome_avulso: "Bahia" },
    { id: 2, nome_avulso: "ANA" },
    { id: 3, nome_avulso: "Ana" },
  ]);
  assert.deepEqual(nomes(juntas).slice(0, 2).sort(), ["ANA", "Ana"]);
  assert.equal(nomes(juntas)[2], "Bahia");
});

test("os itens da programação ordenam pelo nome exibido, inclusive o avulso", () => {
  const itens = [
    { id: 10, fornecedor_id: 1, fornecedores: { razao_social: "ZETA Serviços Ltda." }, valor_a_pagar: 900000 },
    { id: 11, fornecedor_id: 3, fornecedores: { razao_social: "José da Silva Comércio de Alimentos Ltda.", apelido: "Zé Alimentos" }, nome_exibicao_programacao: "Merenda — Zé Alimentos", valor_a_pagar: 15000 },
    { id: 12, fornecedor_id: null, nome_avulso: "Álvaro Transportes", valor_a_pagar: 4000 },
    { id: 13, fornecedor_id: 4, fornecedores: { razao_social: "bahia distribuidora s/a" }, valor_a_pagar: 250000 },
  ];

  const ordenados = ordenarPagamentosPorNome(itens);

  // Nome de exibição da programação manda: o item do "Zé Alimentos" aparece em
  // "Merenda — ...", e é aí que ele ordena. O avulso entra pelo nome digitado.
  assert.deepEqual(nomes(ordenados), [
    "Álvaro Transportes",
    "bahia distribuidora s/a",
    "Merenda — Zé Alimentos",
    "ZETA Serviços Ltda.",
  ]);

  // Nem valor, nem vínculo, nem total mudam por causa da ordem.
  assert.deepEqual(ordenados.map((item) => item.valor_a_pagar), [4000, 250000, 15000, 900000]);
  assert.deepEqual(ordenados.map((item) => item.fornecedor_id), [null, 4, 3, 1]);
  assert.equal(somarPagamentos(ordenados), somarPagamentos(itens));
  assert.equal(somarPagamentos(ordenados), 1169000);
});

test("acrescentar fornecedor coloca o item na posição certa sem mexer no que já estava", () => {
  const cristal = { id: 20, fornecedor_id: 5, fornecedores: { razao_social: "Cristal Papelaria ME" }, valor_a_pagar: 30.5 };
  const zeta = { id: 21, fornecedor_id: 1, fornecedores: { razao_social: "ZETA Serviços Ltda." }, valor_a_pagar: 900000 };
  const antes = [cristal, zeta];

  // O valor digitado à mão antes da inclusão.
  const comValorAjustado = definirValorProgramado(antes, zeta, 1000);
  const bahia = { id: null, fornecedor_id: 4, fornecedores: { razao_social: "bahia distribuidora s/a" }, valor_a_pagar: 250000 };
  const depois = ordenarPagamentosPorNome([...comValorAjustado, bahia]);

  assert.deepEqual(nomes(depois), ["bahia distribuidora s/a", "Cristal Papelaria ME", "ZETA Serviços Ltda."]);
  // O valor ajustado continua no item ajustado, e o do vizinho não foi tocado.
  assert.deepEqual(depois.map((item) => item.valor_a_pagar), [250000, 30.5, 1000]);
  assert.equal(somarPagamentos(depois), 251030.5);
});

test("a linha é identificada pelo que o item é, não pela posição na lista", () => {
  const gravado = { id: 30, fornecedor_id: 9, valor_a_pagar: 100 };
  const naoGravado = { id: null, fornecedor_id: 4, valor_a_pagar: 200 };
  const avulso = { id: null, fornecedor_id: null, nome_avulso: "Álvaro Transportes", valor_a_pagar: 300 };
  const outroAvulsoMesmoNome = { id: null, fornecedor_id: null, nome_avulso: "álvaro transportes", valor_a_pagar: 400 };

  const chaves = chavesDeExibicaoDosPagamentos([gravado, naoGravado, avulso, outroAvulsoMesmoNome]);
  assert.equal(chaves.get(gravado), "id:30");
  assert.equal(chaves.get(naoGravado), "fornecedor:4");
  assert.equal(chaves.get(avulso), "avulso:álvaro transportes");
  // Dois avulsos com o mesmo nome são numerados pela ordem de inclusão.
  assert.equal(chaves.get(outroAvulsoMesmoNome), "avulso:álvaro transportes#2");

  // Acrescentar item novo NÃO muda a chave de quem já estava: a linha em que a
  // pessoa está digitando não é remontada quando a lista reordena.
  const novo = { id: null, fornecedor_id: 7, valor_a_pagar: 500 };
  const depois = chavesDeExibicaoDosPagamentos([gravado, naoGravado, avulso, outroAvulsoMesmoNome, novo]);
  assert.equal(depois.get(gravado), "id:30");
  assert.equal(depois.get(naoGravado), "fornecedor:4");
  assert.equal(depois.get(avulso), "avulso:álvaro transportes");
  assert.equal(depois.get(outroAvulsoMesmoNome), "avulso:álvaro transportes#2");
  assert.equal(depois.get(novo), "fornecedor:7");
});

test("a tabela da execução mostra a mesma ordem sem mexer na conta definida", () => {
  const itens = ordenarPagamentosPorNome([
    { id: 41, fornecedor_id: 1, fornecedores: { razao_social: "ZETA Serviços Ltda." }, valor_a_pagar: 900000, conta_origem_id: 8 },
    { id: 42, fornecedor_id: 4, fornecedores: { razao_social: "bahia distribuidora s/a" }, valor_a_pagar: 250000, conta_origem_id: null },
    { id: 43, fornecedor_id: 5, fornecedores: { razao_social: "Cristal Papelaria ME" }, valor_a_pagar: 30.5, conta_origem_id: 9 },
  ]);

  assert.deepEqual(nomes(itens), ["bahia distribuidora s/a", "Cristal Papelaria ME", "ZETA Serviços Ltda."]);
  assert.deepEqual(itens.map((item) => item.conta_origem_id), [null, 9, 8]);

  // O resumo da execução não depende da ordem: contagem e totais são os mesmos.
  const resumo = resumoExecucao(itens, [{ id: 8, nome_conta: "Conta A", saldo: 1000000 }, { id: 9, nome_conta: "Conta B", saldo: 1000 }]);
  assert.equal(resumo.comConta, 2);
  assert.equal(resumo.semConta, 1);
  assert.equal(resumo.total, 1150030.5);
});

test("impressão, PDF e Excel saem na mesma ordem em que a tela foi lida", () => {
  const itens = ordenarPagamentosPorNome([
    { id: 51, fornecedores: { razao_social: "ZETA Serviços Ltda." }, valor_a_pagar: 900000 },
    { id: 52, nome_avulso: "Álvaro Transportes", valor_a_pagar: 4000 },
    { id: 53, fornecedores: { razao_social: "bahia distribuidora s/a" }, valor_a_pagar: 250000 },
  ]);
  // Exatamente a carga que a tela monta em dadosDocumento().
  const dados = {
    secretaria: "Finanças",
    data: "10/09/2026",
    pagamentos: itens.map((item) => ({ fornecedor: nomeExibicaoDoPagamento(item), valor: item.valor_a_pagar })),
    totalContas: 2000000,
    totalProgramado: somarPagamentos(itens),
    restante: 2000000 - somarPagamentos(itens),
  };

  const html = htmlProgramacao(dados);
  const posicao = (nome) => html.indexOf(nome);
  assert.ok(posicao("Álvaro Transportes") > 0);
  assert.ok(posicao("Álvaro Transportes") < posicao("bahia distribuidora s/a"));
  assert.ok(posicao("bahia distribuidora s/a") < posicao("ZETA Serviços Ltda."));

  const { planilha } = montarPlanilhaProgramacao(dados);
  const nomesDaColunaA = Object.entries(planilha)
    .filter(([chave]) => /^A\d+$/.test(chave))
    .sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1)))
    .map(([, celula]) => celula.v);
  assert.deepEqual(
    nomesDaColunaA.filter((nome) => ["Álvaro Transportes", "bahia distribuidora s/a", "ZETA Serviços Ltda."].includes(nome)),
    ["Álvaro Transportes", "bahia distribuidora s/a", "ZETA Serviços Ltda."],
  );

  // O total programado é o mesmo, venha de onde vier a ordem.
  assert.equal(dados.totalProgramado, 1154000);
});

test("a ordem por maior valor em aberto continua existindo, só não é mais o padrão", () => {
  const porAberto = ordenarFornecedoresPorAberto(CADASTROS);
  assert.deepEqual(porAberto.map((item) => item.id), [1, 4, 3, 5, 2]);
});

test("a tela usa a lista ordenada nos escolhidos, na execução e no papel", async () => {
  const pagina = await read(PAGINA);

  // Uma única ordem para a programação inteira.
  assert.match(pagina, /const pagamentosOrdenados = React\.useMemo\(\(\) => ordenarPagamentosPorNome\(pagamentos\), \[pagamentos\]\);/);
  // Lista de seleção da Proposta.
  assert.match(pagina, /setFornecedores\(ordenarFornecedoresPorNome\(/);
  // Lista dos escolhidos e lista de valores (duas vezes a mesma linha).
  assert.equal((pagina.match(/pagamentosOrdenados\.map\(\(pagamento, indice\)/g) ?? []).length, 2);
  // Tabela de definir a conta de cada pagamento.
  assert.match(pagina, /pagamentos=\{pagamentosOrdenados\}/);
  // Impressão, PDF e Excel: a mesma carga, a mesma ordem.
  assert.match(pagina, /pagamentos: pagamentosOrdenados\.map\(\(item\) => \(\{ fornecedor: nomePagamento\(item\), valor: numero\(item\.valor_a_pagar\) \}\)\)/);
  assert.match(pagina, /imprimirProgramacao\(dadosDocumento\(\)\)/);
  assert.match(pagina, /gerarPdfProgramacao\(dadosDocumento\(\)\)/);
  assert.match(pagina, /exportarExcelProgramacao\(dadosDocumento\(\)\)/);

  // O rótulo da seção diz a ordem que a tela realmente usa.
  assert.match(pagina, /"Ordem alfabética"/);
  assert.doesNotMatch(pagina, /Maior valor em aberto primeiro/);
  // Nenhum seletor de ordenação foi inventado na Proposta.
  assert.doesNotMatch(pagina, /ordenarFornecedoresPorAberto/);

  // A linha é identificada pelo item, não pela posição: o valor sendo digitado
  // e a renomeação aberta sobrevivem à reordenação.
  assert.match(pagina, /chavesDeExibicaoDosPagamentos\(pagamentos\)/);
  assert.match(pagina, /key=\{chaveDoPagamento\(pagamento, indice\)\}/);
  assert.match(pagina, /data-item-programacao=\{chaveDoPagamento\(pagamento, indice\)\}/);
  // O item recém-incluído é trazido à vista com a menor rolagem possível.
  assert.match(pagina, /scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)/);

  // Salvar e aprovar continuam gravando a lista de verdade, não a ordenada.
  assert.match(pagina, /const payloadPagamentos = pagamentos\.map\(\(item\) => \(\{/);
  assert.match(pagina, /supabase\.rpc\("salvar_planejamento_programacao", argumentos\)/);
  assert.match(pagina, /await aprovarProgramacao\(\{/);
});
