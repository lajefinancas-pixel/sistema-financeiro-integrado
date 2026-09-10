// Testes obrigatórios da correção do SALDO CONGELADO da programação.
//
// A regra que estes testes travam:
//
//   PROGRAMAÇÃO É DOCUMENTO -> reaberta em outro dia, ela mostra o saldo que as
//     contas tinham quando foi montada, e não o saldo de hoje.
//   PROGRAMAÇÃO DO DIA CONTINUA COMO ERA -> em elaboração e do dia corrente,
//     ela busca o saldo atual; marcar e desmarcar conta recalcula na hora.
//   O TOTAL BATE COM A SOMA DO QUE ESTÁ EXIBIDO -> sempre.
//   O PAPEL MOSTRA O MESMO QUE A TELA -> impressão, PDF e planilha saem dos
//     mesmos valores, inclusive a ausência de valor.
//   SEM REGISTRO NÃO É ZERO E NÃO É O SALDO DE HOJE -> aparece "--" com aviso.
//   SALVAR NÃO REESCREVE O DOCUMENTO -> salvar uma programação antiga regrava o
//     mesmo saldo congelado que já estava gravado.
//
// Nada aqui altera saldo, lançamento de saldos_historico ou dado já gravado: a
// correção é de leitura e exibição.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  TEXTO_SEM_REGISTRO,
  aplicarSaldosCongelados,
  avisoSaldoCongelado,
  contasSemSaldoCongelado,
  dataDaProgramacao,
  mapaSaldosCongelados,
  programacaoEmMontagem,
  saldoParaGravar,
  saldoRegistrado,
  semRegistroDeSaldoCongelado,
  somarSaldosCongelados,
  usaSaldoCongelado,
} from "../src/lib/saldoCongeladoProgramacao.js";
import { somarContasSelecionadas } from "../src/lib/planejamentoPagamentos.js";
import { contasSelecionadasDaLista, linhaDaConta } from "../src/lib/contasBancariasBusca.js";
import { htmlProgramacao, montarPlanilhaProgramacao } from "../src/lib/programacaoDocumento.js";
import { formatBRL } from "../src/lib/moeda.js";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const PAGINA = "src/pages/PagamentosRedesenhado.jsx";
// A definição vigente de salvar_planejamento_programacao: é ela que grava o
// saldo considerado de cada conta e o total no cabeçalho.
const MIGRATION_SALVAR = "supabase/migrations/20260905120000_apelido_fornecedor_e_nome_exibicao_programacao.sql";

const HOJE = "2026-09-09";

// O caso do comando: a programação de 02/09 foi montada com estes saldos...
const CONGELADAS_0209 = [
  { conta_id: 11, saldo_considerado: "180000.00", ordem: 1 },
  { conta_id: 12, saldo_considerado: "42350.75", ordem: 2 },
];

// ...e hoje as mesmas contas têm outro saldo (foi isto que a tela mostrava).
const CONTAS_HOJE = [
  { id: 11, nome_conta: "FUNDEB", numero_conta: "2.042-7", banco: "BB", secretaria: "EDUCAÇÃO", secretaria_id: 3, saldo: 5000, saldoDisponivel: 5000 },
  { id: 12, nome_conta: "MERENDA", numero_conta: "1.001-9", banco: "CAIXA", secretaria: "EDUCAÇÃO", secretaria_id: 3, saldo: 990000, saldoDisponivel: 990000 },
  { id: 13, nome_conta: "TRANSPORTE", numero_conta: "3.300-1", banco: "BB", secretaria: "EDUCAÇÃO", secretaria_id: 3, saldo: 77000, saldoDisponivel: 77000 },
];

const PROGRAMACAO_0209 = { id: 41, data_programacao: "2026-09-02", status: "em_elaboracao", fechado: false, saldo_considerado: "222350.75" };
const SELECIONADAS_0209 = new Set([11, 12]);

/** O que a tela monta ao abrir a programação: contas, total e avisos. */
function telaDaProgramacao({ programacao, contas, vinculadas, selecionadas, hoje = HOJE }) {
  const modoCongelado = usaSaldoCongelado({ programacao, hoje });
  const semRegistro = semRegistroDeSaldoCongelado({
    linhas: vinculadas,
    saldoCabecalho: programacao?.saldo_considerado,
  });
  const lista = modoCongelado
    ? aplicarSaldosCongelados(contas, { saldos: mapaSaldosCongelados(vinculadas), semRegistro })
    : contas;
  const exibidas = contasSelecionadasDaLista(lista, selecionadas);
  const total = modoCongelado ? somarSaldosCongelados(exibidas) : somarContasSelecionadas(contas, selecionadas);
  return { modoCongelado, semRegistro, lista, exibidas, total, semSaldo: contasSemSaldoCongelado(exibidas) };
}

test("programação de data anterior exibe o saldo daquele dia, não o de hoje", () => {
  const tela = telaDaProgramacao({
    programacao: PROGRAMACAO_0209,
    contas: CONTAS_HOJE,
    vinculadas: CONGELADAS_0209,
    selecionadas: SELECIONADAS_0209,
  });

  assert.equal(tela.modoCongelado, true);
  assert.deepEqual(tela.exibidas.map((conta) => conta.saldo), [180000, 42350.75]);
  // O saldo de hoje não aparece em lugar nenhum da lista exibida.
  assert.deepEqual(tela.exibidas.map((conta) => conta.saldoAtual), [5000, 990000]);
  assert.equal(tela.exibidas.some((conta) => conta.saldo === 5000 || conta.saldo === 990000), false);
  // Conta que não estava na programação não recebe saldo nenhum de hoje.
  assert.equal(tela.lista.find((conta) => conta.id === 13).saldo, null);
  assert.equal(linhaDaConta(tela.lista.find((conta) => conta.id === 13)).saldo, null);
});

test("o Saldo da Programação bate com a soma dos saldos congelados exibidos", () => {
  const tela = telaDaProgramacao({
    programacao: PROGRAMACAO_0209,
    contas: CONTAS_HOJE,
    vinculadas: CONGELADAS_0209,
    selecionadas: SELECIONADAS_0209,
  });

  const soma = tela.exibidas.reduce((total, conta) => total + conta.saldo, 0);
  assert.equal(tela.total, Math.round(soma * 100) / 100);
  assert.equal(tela.total, 222350.75);
  // E não é a soma dos saldos de hoje das mesmas contas.
  assert.notEqual(tela.total, somarContasSelecionadas(CONTAS_HOJE, SELECIONADAS_0209));
});

test("programação nova de hoje continua usando o saldo atual das contas", () => {
  const nova = { id: 90, data_programacao: HOJE, status: "em_elaboracao", fechado: false, saldo_considerado: 0 };
  assert.equal(programacaoEmMontagem({ programacao: nova, hoje: HOJE }), true);

  const tela = telaDaProgramacao({
    programacao: nova,
    contas: CONTAS_HOJE,
    vinculadas: [],
    selecionadas: new Set([11, 12]),
  });

  assert.equal(tela.modoCongelado, false);
  assert.deepEqual(tela.exibidas.map((conta) => conta.saldo), [5000, 990000]);
  assert.equal(tela.total, 995000);

  // Marcar e desmarcar continua recalculando o total na hora.
  assert.equal(somarContasSelecionadas(CONTAS_HOJE, new Set([11, 12, 13])), 1072000);
  assert.equal(somarContasSelecionadas(CONTAS_HOJE, new Set([11])), 5000);
});

test("programação sem programação aberta e de data futura seguem no saldo atual", () => {
  assert.equal(usaSaldoCongelado({ programacao: null, hoje: HOJE }), false);
  const futura = { data_programacao: "2026-09-30", status: "em_elaboracao", fechado: false };
  assert.equal(usaSaldoCongelado({ programacao: futura, hoje: HOJE }), false);
});

test("aprovada e fechada exibem o saldo congelado mesmo sendo do dia corrente", () => {
  const aprovadaHoje = { id: 42, data_programacao: HOJE, status: "aprovada", fechado: false };
  const fechadaHoje = { id: 43, data_programacao: HOJE, status: "em_elaboracao", fechado: true };
  assert.equal(usaSaldoCongelado({ programacao: aprovadaHoje, hoje: HOJE }), true);
  assert.equal(usaSaldoCongelado({ programacao: fechadaHoje, hoje: HOJE }), true);

  const tela = telaDaProgramacao({
    programacao: aprovadaHoje,
    contas: CONTAS_HOJE,
    vinculadas: CONGELADAS_0209,
    selecionadas: SELECIONADAS_0209,
  });
  assert.deepEqual(tela.exibidas.map((conta) => conta.saldo), [180000, 42350.75]);
});

test("programação antiga sem saldo gravado mostra ausência, e não o saldo de hoje", () => {
  const antiga = { id: 7, data_programacao: "2026-08-10", status: "em_elaboracao", fechado: false, saldo_considerado: 0 };
  const vinculadas = [{ conta_id: 11, saldo_considerado: 0 }, { conta_id: 12, saldo_considerado: 0 }];

  const tela = telaDaProgramacao({ programacao: antiga, contas: CONTAS_HOJE, vinculadas, selecionadas: SELECIONADAS_0209 });

  assert.equal(tela.semRegistro, true);
  assert.deepEqual(tela.exibidas.map((conta) => conta.saldo), [null, null]);
  assert.equal(tela.semSaldo, 2);
  assert.equal(tela.total, 0); // nada é estimado para cobrir o que falta
  const aviso = avisoSaldoCongelado({ dataFormatada: "10/08/2026", semRegistro: true });
  assert.match(aviso, /não tem o saldo das contas gravado/);
  assert.match(aviso, new RegExp(TEXTO_SEM_REGISTRO));
});

test("em programação com registro, conta zerada continua valendo R$ 0,00", () => {
  const vinculadas = [{ conta_id: 11, saldo_considerado: "180000.00" }, { conta_id: 12, saldo_considerado: "0.00" }];
  const tela = telaDaProgramacao({
    programacao: { ...PROGRAMACAO_0209, saldo_considerado: "180000.00" },
    contas: CONTAS_HOJE,
    vinculadas,
    selecionadas: SELECIONADAS_0209,
  });

  assert.equal(tela.semRegistro, false);
  assert.deepEqual(tela.exibidas.map((conta) => conta.saldo), [180000, 0]);
  assert.equal(tela.semSaldo, 0);
  assert.equal(tela.total, 180000);
});

test("conta acrescentada a uma programação antiga aparece sem saldo daquele dia", () => {
  const tela = telaDaProgramacao({
    programacao: PROGRAMACAO_0209,
    contas: CONTAS_HOJE,
    vinculadas: CONGELADAS_0209,
    selecionadas: new Set([11, 12, 13]),
  });
  assert.deepEqual(tela.exibidas.map((conta) => conta.saldo), [180000, 42350.75, null]);
  assert.equal(tela.semSaldo, 1);
  assert.equal(tela.total, 222350.75);
  assert.match(avisoSaldoCongelado({ dataFormatada: "02/09/2026", quantidadeSemRegistro: 1 }), /1 conta não tem/);
});

test("salvar uma programação antiga regrava o mesmo saldo congelado", () => {
  const lista = aplicarSaldosCongelados(CONTAS_HOJE, { saldos: mapaSaldosCongelados(CONGELADAS_0209) });
  const gravar = (id) => saldoParaGravar({ conta: lista.find((conta) => conta.id === id), modoCongelado: true });

  assert.equal(gravar(11), 180000);
  assert.equal(gravar(12), 42350.75);
  // Conta acrescentada agora: grava o saldo considerado no momento em que entrou.
  assert.equal(gravar(13), 77000);

  // Programação antiga inteira sem registro: o que está gravado (zero) é
  // regravado como está -- salvar não troca o documento pelos números de hoje.
  const semRegistro = aplicarSaldosCongelados(CONTAS_HOJE, {
    saldos: mapaSaldosCongelados([{ conta_id: 11, saldo_considerado: 0 }]),
    semRegistro: true,
  });
  assert.equal(saldoParaGravar({ conta: semRegistro.find((conta) => conta.id === 11), modoCongelado: true }), 0);

  // Programação do dia: grava o saldo atual, como sempre.
  assert.equal(saldoParaGravar({ conta: CONTAS_HOJE[0], modoCongelado: false }), 5000);
});

test("a impressão de uma programação anterior traz os mesmos valores da tela", () => {
  const tela = telaDaProgramacao({
    programacao: PROGRAMACAO_0209,
    contas: CONTAS_HOJE,
    vinculadas: CONGELADAS_0209,
    selecionadas: new Set([11, 12, 13]),
  });

  const html = htmlProgramacao({
    secretaria: "EDUCAÇÃO",
    data: "02/09/2026",
    contas: tela.exibidas.map((conta) => ({ banco: conta.banco, conta: conta.numero_conta, saldo: conta.saldo ?? null, nome: conta.nome_conta })),
    pagamentos: [{ fornecedor: "ZÉ ALIMENTOS", valor: 100000 }],
    totalContas: tela.total,
    totalProgramado: 100000,
    restante: tela.total - 100000,
  });

  assert.ok(html.includes(formatBRL(180000)), "o papel mostra o saldo congelado da conta");
  assert.ok(html.includes(formatBRL(42350.75)));
  assert.ok(html.includes(formatBRL(222350.75)), "o total das contas é o mesmo da tela");
  // Saldo de hoje não vai para o papel.
  assert.equal(html.includes(formatBRL(990000)), false);
  // Conta sem saldo daquele dia sai como "--", igual à tela.
  assert.match(html, /<td class="saldo">--<\/td>/);
});

test("o papel de uma programação sem registro nenhum não inventa total", () => {
  const html = htmlProgramacao({
    contas: [{ banco: "BB", conta: "2.042-7", saldo: null, nome: "FUNDEB" }],
    pagamentos: [{ fornecedor: "ZÉ ALIMENTOS", valor: 100000 }],
    totalContas: null,
    totalProgramado: 100000,
    restante: null,
  });

  assert.match(html, /TOTAL DAS CONTAS:<\/span><span>--</);
  assert.match(html, /SALDO RESTANTE:<\/td><td class="valor">--</);
  assert.equal(html.includes("acima do saldo das contas selecionadas"), false);
});

test("a planilha não soma saldo que ninguém gravou", () => {
  const { planilha } = montarPlanilhaProgramacao({
    contas: [
      { banco: "BB", conta: "2.042-7", saldo: 180000, nome: "FUNDEB" },
      { banco: "BB", conta: "3.300-1", saldo: null, nome: "TRANSPORTE" },
    ],
    pagamentos: [{ fornecedor: "ZÉ ALIMENTOS", valor: 100000 }],
    totalContas: 180000,
    totalProgramado: 100000,
    restante: 80000,
  });

  const celulas = Object.entries(planilha).filter(([chave]) => /^C\d+$/.test(chave)).map(([, celula]) => celula);
  assert.ok(celulas.some((celula) => celula.v === 180000 && celula.t === "n"), "saldo gravado sai como número");
  assert.ok(celulas.some((celula) => celula.v === TEXTO_SEM_REGISTRO), "saldo ausente sai como '--'");
  // A célula de "--" não é marcada como moeda nem entra em fórmula de soma.
  const ausente = celulas.find((celula) => celula.v === TEXTO_SEM_REGISTRO);
  assert.equal(ausente.z, undefined);
  assert.equal(ausente.f, undefined);
});

test("o módulo do saldo congelado só lê: não tem banco, não grava e não recalcula", async () => {
  const fonte = await read("src/lib/saldoCongeladoProgramacao.js");
  assert.equal(/supabase|from\(|rpc\(|insert|update|delete/i.test(fonte), false);
  // Nem para conferir: as únicas menções a saldos_historico são as linhas de
  // comentário que dizem que o módulo não mexe nele.
  const codigo = fonte.split("\n").filter((linha) => !linha.trimStart().startsWith("//")).join("\n");
  assert.equal(/saldos_historico/.test(codigo), false);
  // Ausência de registro nunca vira zero na leitura.
  assert.equal(saldoRegistrado(null), null);
  assert.equal(saldoRegistrado(""), null);
  assert.equal(saldoRegistrado("abc"), null);
  assert.equal(saldoRegistrado("0"), 0);
  assert.equal(dataDaProgramacao({ data_programacao: "2026-09-02T00:00:00" }), "2026-09-02");
});

test("a tela lê o saldo gravado da programação em vez de buscar o saldo atual", async () => {
  const pagina = await read(PAGINA);
  assert.match(pagina, /usaSaldoCongelado\(\{ programacao, hoje: hojeISO\(\) \}\)/);
  assert.match(pagina, /aplicarSaldosCongelados\(contas, \{ saldos: saldosCongelados, semRegistro: semRegistroCongelado \}\)/);
  assert.match(pagina, /mapaSaldosCongelados\(vinculadas\)/);
  // O total sai da soma do que está exibido nos dois casos.
  assert.match(pagina, /const totalDisponivel = modoSaldoCongelado\n\s*\? somarSaldosCongelados\(contasSelecionadasComSaldo\)\n\s*: somarContasSelecionadas\(contas, contasSelecionadas\);/);
  // A lista de contas de trabalho, o resumo e o papel usam a mesma lista.
  assert.match(pagina, /contasSelecionadasDaLista\(contasDaProgramacao, contasSelecionadas\)/);
  assert.match(pagina, /contas=\{contasDaProgramacao\}/);
  // Salvar continua gravando o saldo considerado, agora preservando o gravado.
  assert.match(pagina, /saldo_considerado: numero\(saldoParaGravar\(\{ conta, modoCongelado: modoSaldoCongelado \}\)\)/);
  // A etapa de execução recebe a MESMA lista das contas de trabalho: numa
  // programação de data anterior a conta não pode mostrar um saldo no topo da
  // tela e outro embaixo.
  assert.match(pagina, /<PainelExecucaoProgramacao\n\s*programacao=\{programacao\}\n\s*pagamentos=\{pagamentosOrdenados\}\n\s*contas=\{contasDaProgramacao\}/);
  assert.match(pagina, /saldoCongelado=\{modoSaldoCongelado\}/);
  // Salvar e aprovar continuam de pé.
  assert.match(pagina, /supabase\.rpc\("salvar_planejamento_programacao", argumentos\)/);
  assert.match(pagina, /await aprovarProgramacao\(\{/);
});

test("o banco continua gravando o saldo considerado de cada conta ao salvar", async () => {
  const sql = await read(MIGRATION_SALVAR);
  // Conta que já estava na programação: o valor enviado é regravado.
  assert.match(sql, /set saldo_considerado = round\(coalesce\(\(v_conta->>'saldo_considerado'\)::numeric, 0\), 2\)/);
  // Conta nova: entra com o saldo considerado no momento em que entrou.
  assert.match(sql, /programacao_id, conta_id, saldo_considerado, ordem, ativa, valor_rateado/);
  // Cabeçalho da programação: o total considerado.
  assert.match(sql, /set saldo_considerado = round\(coalesce\(p_saldo_considerado, 0\), 2\)/);
});
