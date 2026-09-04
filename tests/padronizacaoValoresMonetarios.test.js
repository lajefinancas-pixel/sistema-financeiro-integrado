// Padronização dos valores monetários no formato brasileiro: R$ 1.234,56.
//
// O que estes testes travam:
//
//   EXIBIÇÃO -- ponto no milhar, vírgula no decimal, sempre duas casas, em
//   qualquer entrada (número do código, string vinda de coluna numeric, texto
//   digitado). O formato antigo, `valor.toLocaleString("pt-BR", { style:
//   "currency" })`, devolvia a string CRUA quando o valor chegava como texto do
//   banco -- é o defeito que a formatação compartilhada resolve.
//
//   DIGITAÇÃO -- a máscara agrupa o milhar sozinha e o que vai para o banco é
//   sempre número puro. A máscara é só de interface.
//
//   COLAGEM -- valor copiado de planilha ("1234.56"), digitado com vírgula
//   ("1234,56") ou copiado do próprio sistema ("R$ 1.234,56") entram como o
//   mesmo número.
//
//   PLANILHA -- valor sai como NÚMERO com o formato de moeda gravado na célula.
//   É o que faz a coluna somar no Excel de quem recebe o arquivo.
//
//   UM ÚNICO UTILITÁRIO -- nenhuma tela reimplementa a formatação nem a máscara.
//
// Nada aqui muda regra de negócio: os números conferidos são os mesmos, só a
// apresentação e a leitura da entrada é que passaram a ser únicas.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";

import {
  colunasPorCabecalho,
  formatBRL,
  formatBRLSeNumerico,
  formatBRLSimples,
  FORMATO_MOEDA_PLANILHA,
  marcarCelulasDeMoeda,
  marcarColunasDeMoeda,
  mascararMoedaCompleta,
  mascararMoedaDigitando,
  paraNumeroMoeda,
} from "../src/lib/moeda.js";
import { linhasParaLancamento } from "../src/lib/lancamentoSaldosRegras.js";

const read = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

// O separador do "R$" no pt-BR é um espaço estreito, não o espaço comum.
const semEspacoEstreito = (texto) => texto.replace(/[\u00A0\u202F]/g, " ");

// ---------------------------------------------------------------------------
// 1. Exibição
// ---------------------------------------------------------------------------

test("exibição usa ponto no milhar, vírgula no decimal e sempre duas casas", () => {
  assert.equal(semEspacoEstreito(formatBRL(1234.56)), "R$ 1.234,56");
  assert.equal(semEspacoEstreito(formatBRL(1234.5)), "R$ 1.234,50");
  assert.equal(semEspacoEstreito(formatBRL(1234)), "R$ 1.234,00");
  assert.equal(semEspacoEstreito(formatBRL(1000000)), "R$ 1.000.000,00");
  assert.equal(semEspacoEstreito(formatBRL(0)), "R$ 0,00");
  assert.equal(semEspacoEstreito(formatBRL(0.05)), "R$ 0,05");
  assert.equal(semEspacoEstreito(formatBRL(-1000)), "-R$ 1.000,00");
});

test("valor sem informação vira R$ 0,00, como nas telas antes da padronização", () => {
  for (const vazio of [null, undefined, ""]) {
    assert.equal(semEspacoEstreito(formatBRL(vazio)), "R$ 0,00");
  }
});

test("valor que chega como texto do banco também é formatado", () => {
  // Coluna numeric do Postgres chega como string. O formatador que cada tela
  // mantinha por conta própria devolvia esse texto cru, sem "R$" e sem vírgula.
  const cru = (1234.56).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  assert.equal(semEspacoEstreito(cru), "R$ 1.234,56");
  assert.equal("1234.56".toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), "1234.56");

  assert.equal(semEspacoEstreito(formatBRL("1234.56")), "R$ 1.234,56");
  assert.equal(semEspacoEstreito(formatBRL("194631.04")), "R$ 194.631,04");
  assert.equal(semEspacoEstreito(formatBRL("0")), "R$ 0,00");
});

test("impressão e PDF recebem o mesmo número, só sem caractere fora do ASCII", () => {
  assert.equal(formatBRLSimples(1234.56), "R$ 1.234,56");
  assert.equal(formatBRLSimples(-1234.56), "-R$ 1.234,56");
  assert.equal(formatBRLSimples("1234.56"), formatBRLSimples(1234.56));
});

// ---------------------------------------------------------------------------
// 2. Digitação
// ---------------------------------------------------------------------------

test("o separador de milhar aparece sozinho enquanto o usuário digita", () => {
  const teclado = "1234567";
  const parciais = [];
  for (let i = 1; i <= teclado.length; i++) {
    parciais.push(semEspacoEstreito(mascararMoedaDigitando(teclado.slice(0, i))));
  }
  assert.deepEqual(parciais, [
    "R$ 1",
    "R$ 12",
    "R$ 123",
    "R$ 1.234",
    "R$ 12.345",
    "R$ 123.456",
    "R$ 1.234.567",
  ]);
});

test("os centavos em digitação não são completados no meio do caminho", () => {
  assert.equal(semEspacoEstreito(mascararMoedaDigitando("1234,")), "R$ 1.234,");
  assert.equal(semEspacoEstreito(mascararMoedaDigitando("1234,5")), "R$ 1.234,5");
  assert.equal(semEspacoEstreito(mascararMoedaDigitando("1234,56")), "R$ 1.234,56");
  // Ao sair do campo, os centavos fecham.
  assert.equal(semEspacoEstreito(mascararMoedaCompleta("1234,5")), "R$ 1.234,50");
  assert.equal(semEspacoEstreito(mascararMoedaCompleta("1234")), "R$ 1.234,00");
  // Campo em branco continua em branco: não vira R$ 0,00 sozinho.
  assert.equal(mascararMoedaCompleta(""), "");
  assert.equal(mascararMoedaDigitando(""), "");
});

test("o valor gravado no banco é número puro, nunca o texto da máscara", () => {
  const digitado = mascararMoedaCompleta("1234567,89");
  assert.equal(semEspacoEstreito(digitado), "R$ 1.234.567,89");

  const paraOBanco = paraNumeroMoeda(digitado);
  assert.equal(typeof paraOBanco, "number");
  assert.equal(paraOBanco, 1234567.89);

  // Reexibir o que foi gravado devolve exatamente o mesmo texto.
  assert.equal(formatBRL(paraOBanco), digitado);
});

test("lançamento de saldo grava número e ignora campo em branco", () => {
  const linhas = linhasParaLancamento({
    contas: [{ id: 1 }, { id: 2 }, { id: 3 }],
    valores: { 1: "R$ 1.234.567,89", 2: "", 3: "R$ 0,00" },
    data: "2026-09-03",
  });
  // Conta 2 ficou em branco: nenhuma linha é escrita para ela.
  assert.deepEqual(linhas.map((l) => l.conta_id), [1, 3]);
  assert.equal(linhas[0].valor_saldo, 1234567.89);
  assert.equal(linhas[1].valor_saldo, 0);
  for (const linha of linhas) assert.equal(typeof linha.valor_saldo, "number");
});

// ---------------------------------------------------------------------------
// 3. Colagem de outros formatos
// ---------------------------------------------------------------------------

test("valor colado em outro formato entra como o mesmo número", () => {
  const equivalentes = ["1234.56", "1234,56", "R$ 1.234,56", "R$ 1234,56", "1.234,56", " 1234.56 "];
  for (const colado of equivalentes) {
    assert.equal(paraNumeroMoeda(colado), 1234.56, `colagem de ${JSON.stringify(colado)}`);
    // A máscara também aceita a colagem e devolve o formato do sistema.
    assert.equal(semEspacoEstreito(mascararMoedaCompleta(colado)), "R$ 1.234,56", `máscara de ${JSON.stringify(colado)}`);
  }
});

test("colagem de valores grandes e de centavos isolados", () => {
  assert.equal(paraNumeroMoeda("1.234.567,89"), 1234567.89);
  assert.equal(paraNumeroMoeda("1234567.89"), 1234567.89);
  assert.equal(paraNumeroMoeda("0,05"), 0.05);
  assert.equal(paraNumeroMoeda("0.05"), 0.05);
  assert.equal(paraNumeroMoeda("-R$ 1.234,56"), -1234.56);
  // Sem dígito nenhum não há valor: continua zero, como campo vazio.
  assert.equal(paraNumeroMoeda("R$"), 0);
});

// ---------------------------------------------------------------------------
// 4. Planilha: número com formato de moeda, nunca texto
// ---------------------------------------------------------------------------

test("coluna de valor da planilha sai numérica, com o formato brasileiro", () => {
  const cabecalho = ["Fornecedor", "Bruto", "ISS", "Situacao"];
  const linhas = [
    { Fornecedor: "A", Bruto: 1234.56, ISS: "37.04", Situacao: "em_aberto" },
    { Fornecedor: "B", Bruto: 1000000, ISS: 0, Situacao: "em_aberto" },
    { Fornecedor: "C", Bruto: "", ISS: "", Situacao: "sem nota" },
  ];
  const planilha = XLSX.utils.json_to_sheet(linhas, { header: cabecalho });

  const colunas = colunasPorCabecalho(cabecalho, ["Bruto", "ISS"]);
  assert.deepEqual(colunas, [1, 2]);
  marcarColunasDeMoeda(planilha, colunas, { ultimaLinha: linhas.length });

  for (const referencia of ["B2", "C2", "B3", "C3"]) {
    assert.equal(planilha[referencia].t, "n", `${referencia} deveria ser numérica`);
    assert.equal(planilha[referencia].z, FORMATO_MOEDA_PLANILHA);
    assert.equal(typeof planilha[referencia].v, "number");
  }
  // Texto vindo do banco vira número de verdade -- é o que permite somar.
  assert.equal(planilha.C2.v, 37.04);
  assert.equal(planilha.B3.v, 1000000);
  // "Sem nota": célula em branco continua em branco, não vira R$ 0,00.
  assert.ok(!planilha.B4 || planilha.B4.v === "");
  // Coluna de texto não é tocada.
  assert.equal(planilha.A2.t, "s");
  assert.equal(planilha.D2.t, "s");
});

test("célula de total pode carregar a própria fórmula de soma", () => {
  const planilha = XLSX.utils.aoa_to_sheet([
    ["Valor"],
    [1234.56],
    [1000],
    [2234.56],
  ]);
  marcarCelulasDeMoeda(planilha, [
    { linha: 1, coluna: 0 },
    { linha: 2, coluna: 0 },
    { linha: 3, coluna: 0, formula: "SUM(A2:A3)" },
  ]);
  assert.equal(planilha.A4.f, "SUM(A2:A3)");
  for (const referencia of ["A2", "A3", "A4"]) {
    assert.equal(planilha[referencia].t, "n");
    assert.equal(planilha[referencia].z, FORMATO_MOEDA_PLANILHA);
  }
});

test("o arquivo .xlsx gravado e reaberto continua somável", () => {
  const cabecalho = ["Fornecedor", "Valor"];
  const linhas = [
    { Fornecedor: "A", Valor: "1234.56" },
    { Fornecedor: "B", Valor: 1000000 },
    { Fornecedor: "C", Valor: 0.05 },
  ];
  const planilha = XLSX.utils.json_to_sheet(linhas, { header: cabecalho });
  marcarColunasDeMoeda(planilha, colunasPorCabecalho(cabecalho, ["Valor"]), {
    ultimaLinha: linhas.length,
  });
  const livro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(livro, planilha, "Valores");

  // Grava o arquivo de verdade e o lê de volta, como faria quem recebe a
  // exportação: é aqui que se vê se o valor virou texto no caminho.
  const arquivo = XLSX.write(livro, { type: "buffer", bookType: "xlsx" });
  const aba = XLSX.read(arquivo, { type: "buffer", cellNF: true }).Sheets.Valores;

  const valores = ["B2", "B3", "B4"].map((referencia) => {
    const celula = aba[referencia];
    assert.equal(celula.t, "n", `${referencia} voltou como ${celula.t}, não como número`);
    assert.equal(celula.z, FORMATO_MOEDA_PLANILHA, `${referencia} perdeu o formato de moeda`);
    return celula.v;
  });
  // A soma que o Excel faria sobre a coluna, conferida em centavos.
  const soma = valores.reduce((total, valor) => total + valor, 0);
  assert.equal(Math.round(soma * 100), 100123461);
  assert.equal(semEspacoEstreito(formatBRL(soma)), "R$ 1.001.234,61");
});

test("a planilha da programação continua numérica, formatada e com os somatórios", async () => {
  const { montarPlanilhaProgramacao } = await import("../src/lib/programacaoDocumento.js");
  const { planilha } = montarPlanilhaProgramacao({
    secretaria: "SECRETARIA DE FINANÇAS",
    data: "2026-09-03",
    contas: [
      { banco: "BANCO DO BRASIL", conta: "1234-5", saldo: 629746.73, nome: "FPM" },
      { banco: "CAIXA", conta: "9876-1", saldo: 10000, nome: "FUNDEB" },
    ],
    pagamentos: [
      { fornecedor: "FORNECEDOR A", valor: 194631.04 },
      { fornecedor: "FORNECEDOR B", valor: 300 },
    ],
    totalContas: 639746.73,
    totalProgramado: 194931.04,
    restante: 444815.69,
  });

  for (const referencia of ["C10", "C11", "C12", "B16", "B17", "B18", "B20"]) {
    assert.equal(planilha[referencia].t, "n", `${referencia} deveria ser numérica`);
    assert.equal(planilha[referencia].z, FORMATO_MOEDA_PLANILHA);
  }
  assert.equal(planilha.C12.f, "SUM(C10:C11)");
  assert.equal(planilha.B18.f, "SUM(B16:B17)");
  assert.equal(planilha.B20.f, "C12-B18");
  // Os valores conferem com o que a tela mostra.
  assert.equal(planilha.C10.v + planilha.C11.v, 639746.73);
  assert.equal(planilha.B16.v + planilha.B17.v, 194931.04);
});

// ---------------------------------------------------------------------------
// 5. Um único componente / utilitário
// ---------------------------------------------------------------------------

test("nenhuma tela reimplementa a formatação de moeda", async () => {
  const arquivos = [
    "src/pages/Dashboard.jsx",
    "src/pages/Historico.jsx",
    "src/pages/Fornecedores.jsx",
    "src/pages/Saldos.jsx",
    "src/lib/saldosDocumento.js",
    "src/lib/baixasDocumento.js",
  ];
  for (const caminho of arquivos) {
    const codigo = await read(caminho);
    assert.doesNotMatch(
      codigo,
      /style: "currency"/,
      `${caminho} deveria usar lib/moeda.js em vez de formatar por conta própria`,
    );
    assert.match(codigo, /from "[.\/a-z]*moeda(\.js)?"/, `${caminho} deveria importar lib/moeda`);
  }
});

test("todo campo de valor usa o componente com máscara, não input numérico solto", async () => {
  const telas = [
    "src/pages/Fornecedores.jsx",
    "src/pages/Saldos.jsx",
    "src/pages/PagamentosRedesenhado.jsx",
    "src/components/baixas/ModalRegistrarBaixa.jsx",
    "src/components/saldos/ModalContaBancaria.jsx",
    "src/components/pagamentos/ModalTransferenciaEntreContas.jsx",
    "src/components/pagamentos/ModalBaixaPagamento.jsx",
    "src/components/fornecedores/NotasDoFornecedor.jsx",
  ];
  for (const caminho of telas) {
    const codigo = await read(caminho);
    assert.match(codigo, /CampoMoeda/, `${caminho} deveria usar CampoMoeda nos campos de valor`);
  }

  // Fornecedores: os quatro campos de valor da tela passaram pela máscara e os
  // dois campos de alíquota (percentual) continuam numéricos, como devem.
  const fornecedores = await read("src/pages/Fornecedores.jsx");
  for (const campo of ["filtros.valorMin", "filtros.valorMax", "formValor.valor_bruto", "formValor.base_calculo"]) {
    const trecho = new RegExp(`valor=\\{${campo.replace(".", "\\.")}\\}`);
    assert.match(fornecedores, trecho, `${campo} deveria estar em um CampoMoeda`);
  }
  assert.doesNotMatch(fornecedores, /type="number" step="0\.01" placeholder="0,00"/);
  assert.equal((fornecedores.match(/type="number"/g) ?? []).length, 2);
});

test("a máscara nunca decide o que vai para o banco: quem converte é o utilitário", async () => {
  const campo = await read("src/components/CampoMoeda.jsx");
  // O componente entrega o número já convertido pelo utilitário compartilhado.
  assert.match(campo, /paraNumeroMoeda/);
  assert.match(campo, /onValorChange\?\.\(paraNumeroMoeda/);
  assert.doesNotMatch(campo, /supabase|insert|update|upsert/);

  // A leitura do que foi digitado em Fornecedores passa pelo utilitário, não por
  // parseFloat (que não entende o milhar brasileiro).
  const fornecedores = await read("src/pages/Fornecedores.jsx");
  assert.doesNotMatch(fornecedores, /parseFloat\(formValor\.(valor_bruto|base_calculo)/);
  assert.match(fornecedores, /paraNumeroMoeda\(formValor\.valor_bruto\)/);
  assert.equal(paraNumeroMoeda("R$ 1.234,56"), 1234.56);
  assert.ok(Number.isNaN(parseFloat("R$ 1.234,56")));
});

test("as exportações para Excel gravam o formato de moeda pelo utilitário único", async () => {
  const exportadores = {
    "src/lib/relatoriosDocumento.js": /marcarColunasDeMoeda/,
    "src/lib/baixasDocumento.js": /marcarCelulasDeMoeda/,
    "src/lib/programacaoDocumento.js": /marcarCelulasDeMoeda/,
    "src/pages/Saldos.jsx": /marcarColunasDeMoeda/,
    "src/pages/Historico.jsx": /marcarColunasDeMoeda/,
    "src/pages/Fornecedores.jsx": /marcarColunasDeMoeda/,
    "src/pages/DiagnosticoPagamentos.jsx": /marcarColunasDeMoeda/,
  };
  for (const [caminho, esperado] of Object.entries(exportadores)) {
    const codigo = await read(caminho);
    assert.match(codigo, esperado, `${caminho} deveria marcar as células de valor`);
    // Ninguém mais escreve o formato na mão.
    assert.doesNotMatch(codigo, /celula\.z = FORMATO_MOEDA_PLANILHA/, `${caminho} deveria reusar o utilitário`);
  }

  // O exportador genérico de relatórios cobre a Central de Relatórios inteira.
  const relatorios = await read("src/lib/relatoriosDocumento.js");
  assert.match(relatorios, /c\.tipo === "moeda"\) registro\[c\.label\] = paraNumeroMoeda\(valor\)/);
  assert.match(relatorios, /colunas\.filter\(\(c\) => c\.tipo === "moeda"\)/);
});

// ---------------------------------------------------------------------------
// 6. Trilha de auditoria e Histórico de movimentações
//
// A comparação Antes/Depois é o último lugar do sistema em que dinheiro
// aparecia fora do padrão: parte dos eventos é escrita pelas funções do banco
// (baixa, estorno, transferência, aprovação da programação), que gravam o
// número cru em valor_anterior/valor_novo. Na tela isso saía como "1.234,56" --
// sem "R$" e, quando o número vinha como texto de coluna numeric, como
// "1234.56" mesmo.
//
// O mesmo texto alimenta a impressão e o PDF do Histórico, então a correção
// vale para os três de uma vez.
//
// `src/lib/auditoria.js` importa a camada de dados (supabaseClient) e por isso
// não é carregável fora do navegador: aqui o comportamento é conferido no
// utilitário compartilhado e a ligação com a auditoria, na fonte -- é como os
// outros testes de não regressão já leem esse módulo.
// ---------------------------------------------------------------------------

// Lista nominal dos campos de dinheiro da auditoria, lida da própria fonte.
async function camposDeMoedaDaAuditoria() {
  const fonte = await read("src/lib/auditoria.js");
  const lista = /const CAMPOS_DE_MOEDA = new Set\(\[([\s\S]*?)\]\);/.exec(fonte);
  assert.ok(lista, "auditoria.js precisa declarar CAMPOS_DE_MOEDA");
  return new Set([...lista[1].matchAll(/"([^"]+)"/g)].map((c) => c[1]));
}

test("valor de dinheiro na comparação Antes/Depois sai no padrão do sistema", async () => {
  // Evento de baixa, como a função registrar_baixa_nota do banco o grava.
  const antes = { situacao: "em_aberto", valor_pago: 0, valor_em_aberto: 194631.04 };
  const depois = {
    situacao: "parcialmente_pago",
    valor_pago: "1234.56",
    valor_em_aberto: "193396.48",
    valor_da_baixa: 1234.56,
    movimentou_saldo: false,
  };

  const camposDeMoeda = await camposDeMoedaDaAuditoria();
  for (const campo of ["valor_pago", "valor_em_aberto", "valor_da_baixa"]) {
    assert.ok(camposDeMoeda.has(campo), `${campo} é dinheiro e precisa estar na lista`);
  }

  assert.equal(semEspacoEstreito(formatBRLSeNumerico(antes.valor_pago)), "R$ 0,00");
  assert.equal(semEspacoEstreito(formatBRLSeNumerico(depois.valor_pago)), "R$ 1.234,56");
  // Texto de coluna numeric também: era ele que aparecia cru na tela.
  assert.equal(semEspacoEstreito(formatBRLSeNumerico(antes.valor_em_aberto)), "R$ 194.631,04");
  assert.equal(semEspacoEstreito(formatBRLSeNumerico(depois.valor_em_aberto)), "R$ 193.396,48");
  assert.equal(semEspacoEstreito(formatBRLSeNumerico(depois.valor_da_baixa)), "R$ 1.234,56");

  // O que não é dinheiro fica fora da lista e segue com a leitura de sempre: a
  // regra financeira registrada no evento continua legível (a baixa não
  // movimenta saldo) e a situação continua saindo como está gravada.
  assert.ok(!camposDeMoeda.has("movimentou_saldo"));
  assert.ok(!camposDeMoeda.has("situacao"));
});

test("campo parecido com valor, mas que não é dinheiro, não ganha R$", async () => {
  // Identificador, nome de tabela e contagem convivem com os campos de valor
  // nos eventos do banco -- por isso a lista é nominal, nunca por prefixo.
  const camposDeMoeda = await camposDeMoedaDaAuditoria();
  for (const campo of [
    "valor_em_aberto_id",
    "saldos_historico",
    "historico_saldos",
    "valores_em_aberto",
    "saldo_insuficiente",
    "movimentou_saldo",
  ]) {
    assert.ok(!camposDeMoeda.has(campo), `${campo} não é dinheiro`);
  }

  // Texto gravado no lugar do número continua texto: conta cadastrada sem saldo
  // inicial não passa a exibir R$ 0,00.
  assert.equal(formatBRLSeNumerico("Não informado"), null);
  assert.equal(formatBRLSeNumerico("em_aberto"), null);
  assert.equal(formatBRLSeNumerico("2026-09-04"), null);
  assert.equal(formatBRLSeNumerico(true), null);
  assert.equal(formatBRLSeNumerico(null), null);
  // Já o campo de dinheiro sai formatado, venha número ou texto.
  assert.equal(semEspacoEstreito(formatBRLSeNumerico(1234.5)), "R$ 1.234,50");
  assert.equal(semEspacoEstreito(formatBRLSeNumerico("1234.50")), "R$ 1.234,50");
  assert.equal(semEspacoEstreito(formatBRLSeNumerico(0)), "R$ 0,00");
  assert.equal(semEspacoEstreito(formatBRLSeNumerico(-1000)), "-R$ 1.000,00");
  // Reformatar o que a tela já gravou formatado devolve o mesmo texto.
  assert.equal(formatBRLSeNumerico(formatBRL(1234.5)), formatBRL(1234.5));
});

test("a impressão e o PDF do Histórico levam o valor já formatado", async () => {
  // O documento do Histórico monta a linha com os campos da comparação, então
  // a tela, a impressão e o PDF mostram o valor no mesmo formato.
  const documento = await read("src/lib/historicoDocumento.js");
  assert.match(documento, /\$\{m\.label\}: \$\{m\.antes\} → \$\{m\.depois\}/);

  const linha = `Saldo: ${formatBRLSeNumerico("629746.73")} → ${formatBRLSeNumerico("639746.73")}`;
  assert.equal(semEspacoEstreito(linha), "Saldo: R$ 629.746,73 → R$ 639.746,73");
});

test("nenhuma tela reimplementa a leitura de valor da auditoria", async () => {
  const auditoria = await read("src/lib/auditoria.js");
  // A formatação vem do utilitário único, não de um formatador local.
  assert.match(auditoria, /import \{ formatBRLSeNumerico \} from "\.\/moeda"/);
  assert.doesNotMatch(auditoria, /style: "currency"/);
  // E é a leitura da auditoria que aplica a lista, recebendo o nome do campo.
  assert.match(auditoria, /CAMPOS_DE_MOEDA\.has\(chave\)/);
  assert.match(auditoria, /antes: valorLegivel\(antes\[chave\], chave\)/);
  assert.match(auditoria, /depois: valorLegivel\(depois\[chave\], chave\)/);
});
