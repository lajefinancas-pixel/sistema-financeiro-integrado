// Digitação de valor com milhar, um campo de cada módulo, até o que vai para o
// banco.
//
// Cada teste aqui reproduz a digitação tecla por tecla no campo com máscara e
// entrega o resultado à MESMA função que monta o que o sistema grava. O que se
// confere não é o texto na tela: é o número da linha que vai para o Supabase.
//
// A máscara é só de interface. Se ela algum dia começar a mexer no número
// gravado, é aqui que aparece.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { formatBRL, mascararMoedaCompleta, mascararMoedaDigitando, paraNumeroMoeda } from "../src/lib/moeda.js";
import { campoPreenchido, linhasParaLancamento } from "../src/lib/lancamentoSaldosRegras.js";
import { saldoInicialInformado, validarCadastroConta } from "../src/lib/contasBancariasRegras.js";
import { calcularRestante, definirValorProgramado, somarContasSelecionadas, somarPagamentos, valorPlanejamento } from "../src/lib/planejamentoPagamentos.js";
import { centavos, resumoBaixas, situacaoAposBaixa, validarBaixaDeNota, validarValorBaixa } from "../src/lib/regrasBaixas.js";
import { conferirTransferenciaMultipla, pernasParaEnvio } from "../src/lib/regrasTransferencia.js";

/**
 * Digitação real no CampoMoeda: cada tecla passa pela máscara (o componente
 * manda para a máscara o conteúdo do input, que já vem mascarado, com a tecla
 * nova no fim) e a saída do campo completa os centavos.
 *
 * @returns { numero, texto } -- exatamente o par que o componente entrega à
 *          tela: o número é o que segue para o banco, o texto é o que se vê.
 */
function digitar(teclas) {
  let texto = "";
  for (const tecla of String(teclas)) texto = mascararMoedaDigitando(texto + tecla);
  const naTela = texto; // o que aparece enquanto se digita, antes de sair do campo
  texto = mascararMoedaCompleta(texto); // saída do campo
  return { numero: paraNumeroMoeda(texto), texto, naTela };
}

/** Colar por cima do conteúdo do campo (o foco já selecionou tudo). */
function colar(conteudo) {
  const texto = mascararMoedaCompleta(mascararMoedaDigitando(conteudo));
  return { numero: paraNumeroMoeda(texto), texto };
}

const semEspacoEstreito = (texto) => texto.replace(/[\u00A0\u202F]/g, " ");
const MILHAO = 1234567.89; // "1234567,89" teclado, "R$ 1.234.567,89" na tela

test("o campo mostra o milhar enquanto se digita e entrega o número puro", () => {
  const { numero, texto, naTela } = digitar("1234567,89");
  assert.equal(semEspacoEstreito(naTela), "R$ 1.234.567,89");
  assert.equal(semEspacoEstreito(texto), "R$ 1.234.567,89");
  assert.equal(numero, MILHAO);
  assert.equal(typeof numero, "number");
});

// ---------------------------------------------------------------------------
// Saldos das contas
// ---------------------------------------------------------------------------

test("Saldos, lançamento em lote: a linha gravada leva o número digitado", () => {
  const { numero } = digitar("1234567,89");
  // O campo guarda o número; em branco continua em branco (nada é gravado).
  const saldosLote = { 7: numero, 8: "" };

  const linhas = linhasParaLancamento({
    contas: [{ id: 7 }, { id: 8 }],
    valores: saldosLote,
    data: "2026-09-03",
  });

  assert.deepEqual(linhas, [{ conta_id: 7, valor_saldo: MILHAO, data_saldo: "2026-09-03" }]);
  assert.equal(typeof linhas[0].valor_saldo, "number");
});

test("Saldos, saldo de uma conta: campo preenchido e valor convertido", () => {
  const { numero } = digitar("1234567,89");
  assert.equal(campoPreenchido(numero), true);
  // salvarNovoSaldo faz exatamente esta conversão antes de lancarSaldoDaConta.
  assert.equal(paraNumeroMoeda(numero), MILHAO);
  // E o campo esvaziado não vira R$ 0,00 no banco.
  assert.equal(campoPreenchido(""), false);
});

// ---------------------------------------------------------------------------
// Contas bancárias
// ---------------------------------------------------------------------------

test("Contas bancárias: saldo inicial com milhar é aceito e lançado pelo número", () => {
  const { numero } = digitar("1234567,89");
  const cadastro = {
    secretaria_id: "1",
    banco_id: "2",
    nome_conta: "FPM",
    numero_conta: "1234-5",
    tipo_conta: "movimento",
    saldo_inicial: numero,
  };

  const conferencia = validarCadastroConta({ ...cadastro, exigirSaldoInicial: true });
  assert.deepEqual(conferencia.erros, {});
  assert.equal(conferencia.valido, true);
  assert.equal(saldoInicialInformado(numero), true);
  // lancarSaldoDaConta grava paraNumeroMoeda(valor).
  assert.equal(paraNumeroMoeda(cadastro.saldo_inicial), MILHAO);

  // Sem saldo informado a conta nasce sem lançamento, como antes.
  assert.equal(saldoInicialInformado(""), false);
});

// ---------------------------------------------------------------------------
// Pagamentos / programação
// ---------------------------------------------------------------------------

test("Pagamentos: o valor a pagar programado é o número digitado", () => {
  const { numero } = digitar("1234567,89");
  const alvo = { id: "p1", fornecedor_id: "f1", valor_a_pagar: 0 };
  const pagamentos = [alvo, { id: "p2", fornecedor_id: "f2", valor_a_pagar: 300 }];

  const programados = definirValorProgramado(pagamentos, alvo, numero);
  assert.equal(programados[0].valor_a_pagar, MILHAO);
  assert.equal(programados[1].valor_a_pagar, 300);
  // O total da programação, que é o que a tela confere antes de gravar.
  assert.equal(somarPagamentos(programados), 1234867.89);
  // valorPlanejamento é quem escreve o campo no insert.
  assert.equal(valorPlanejamento(numero), MILHAO);
});

// ---------------------------------------------------------------------------
// Baixas de notas
// ---------------------------------------------------------------------------

test("Baixas: o valor pago com milhar passa a conferência e abate a nota", () => {
  const { numero } = digitar("1234567,89");
  const nota = { id: "n1", valor: 2000000, valor_pago: 0, situacao: "em_aberto" };

  assert.deepEqual(validarValorBaixa(numero, 2000000), { ok: true });
  const conferencia = validarBaixaDeNota({
    nota,
    valor: numero,
    dataPagamento: "2026-09-03",
    contaId: "c1",
  });
  assert.equal(conferencia.ok, true, conferencia.mensagem);

  // registrarBaixaNota envia p_valor: paraNumeroMoeda(campos.valor).
  assert.equal(paraNumeroMoeda(numero), MILHAO);
  assert.equal(centavos(numero), MILHAO);
  // A nota continua em aberto porque o pago é menor que o total -- o abatimento
  // usou o número, não o texto.
  assert.equal(situacaoAposBaixa(nota, numero), "em_aberto");
  assert.equal(situacaoAposBaixa(nota, 2000000), "pago");
});

// ---------------------------------------------------------------------------
// Transferências entre contas
// ---------------------------------------------------------------------------

test("Transferências: o valor por origem chega ao envio como número", () => {
  const { numero } = digitar("1234567,89");
  const destino = { id: "d1", saldo: 100, secretaria_id: "s1" };
  const origens = [{ conta: { id: "o1", saldo: 3000000, secretaria_id: "s1" }, valor: numero }];

  const conferencia = conferirTransferenciaMultipla({ destino, origens });
  assert.equal(conferencia.totalTransferir, MILHAO);
  assert.equal(conferencia.saldoDestinoDepois, 1234667.89);
  // Transferência não é despesa: o patrimônio somado não muda.
  assert.equal(conferencia.patrimonioPreservado, true);

  assert.deepEqual(pernasParaEnvio(origens), [{ sourceAccountId: "o1", amount: MILHAO }]);
});

// ---------------------------------------------------------------------------
// Fornecedores (notas em aberto)
// ---------------------------------------------------------------------------

test("Fornecedores: o valor bruto digitado vira número no insert da nota", async () => {
  // Aqui o campo guarda o texto com máscara -- é o que preserva a validação
  // "informe o valor da nota" exatamente como era. A conversão é no salvamento.
  const { texto } = digitar("1234567,89");
  assert.equal(semEspacoEstreito(texto), "R$ 1.234.567,89");
  assert.ok(texto, "campo preenchido continua passando na validação da tela");

  const bruto = paraNumeroMoeda(texto);
  assert.equal(bruto, MILHAO);
  assert.equal(typeof bruto, "number");

  // O ISS de 2% sobre o valor digitado, como calcularISS faz.
  const iss = bruto * 0.02;
  assert.equal(Math.round(iss * 100) / 100, 24691.36);

  // E é este número que vai para o banco, não o texto do campo.
  const codigo = await readFile(new URL("../src/pages/Fornecedores.jsx", import.meta.url), "utf8");
  assert.match(codigo, /const bruto = paraNumeroMoeda\(formValor\.valor_bruto\);/);
  assert.match(codigo, /const base = paraNumeroMoeda\(formValor\.base_calculo \|\| formValor\.valor_bruto\);/);
  assert.match(codigo, /valor_bruto: bruto,/);
  assert.match(codigo, /base_calculo: base,/);
  // Campo vazio continua sendo recusado antes de qualquer conversão.
  assert.match(codigo, /if \(!formValor\.valor_bruto\) throw erroAmigavel\("Informe o valor da nota\."\);/);
});

// ---------------------------------------------------------------------------
// Colagem, em qualquer módulo
// ---------------------------------------------------------------------------

test("valor colado de planilha ou do próprio sistema grava o mesmo número", () => {
  for (const conteudo of ["1234567.89", "1234567,89", "R$ 1.234.567,89", "1.234.567,89"]) {
    const { numero, texto } = colar(conteudo);
    assert.equal(numero, MILHAO, `colagem de ${JSON.stringify(conteudo)}`);
    assert.equal(semEspacoEstreito(texto), "R$ 1.234.567,89");

    // O mesmo valor colado, em qualquer módulo, monta a mesma linha.
    const [linha] = linhasParaLancamento({ contas: [{ id: 1 }], valores: { 1: numero }, data: "2026-09-03" });
    assert.equal(linha.valor_saldo, MILHAO);
    assert.equal(valorPlanejamento(numero), MILHAO);
    assert.equal(centavos(numero), MILHAO);
  }
});

// ---------------------------------------------------------------------------
// Reabrir um valor já gravado e salvar sem alterá-lo
//
// Este é o caminho em que uma máscara mal implementada estraga o número que já
// estava no banco: ao abrir a tela o campo mostra o valor formatado e, quando o
// usuário passa por ele sem digitar nada, o CampoMoeda reenvia para a tela o
// conteúdo do input (é o que o onBlur faz). Se a leitura desse texto não
// devolvesse exatamente o mesmo número, salvar sem mexer em nada mudaria o
// valor gravado.
//
// A coluna de dinheiro do banco é numeric(14,2), então o valor chega como texto
// com duas casas e ponto decimal ("1234567.89") -- é assim que ele entra aqui.
// ---------------------------------------------------------------------------

/** Abrir o campo com o valor do banco e sair dele sem digitar nada. */
function reabrirESair(valorDoBanco) {
  const naTela = formatBRL(valorDoBanco); // textoInicial do CampoMoeda
  const aoSair = mascararMoedaCompleta(naTela); // onBlur, sem digitação nenhuma
  return { naTela, aoSair, numero: paraNumeroMoeda(aoSair) };
}

// Como as colunas numeric(14,2) devolvem os valores, com os casos que já
// causaram confusão: milhão, centavo isolado, zero e grupo de três dígitos.
const GRAVADOS = [
  ["1234567.89", 1234567.89],
  ["1000000.00", 1000000],
  ["194631.04", 194631.04],
  ["999.00", 999],
  ["1234.50", 1234.5],
  ["0.05", 0.05],
  ["0.00", 0],
];

test("reabrir o valor gravado e sair do campo não muda o número", () => {
  for (const [doBanco, esperado] of GRAVADOS) {
    const { numero, naTela, aoSair } = reabrirESair(doBanco);
    assert.equal(numero, esperado, `valor gravado ${doBanco}`);
    assert.equal(typeof numero, "number");
    // O texto exibido também não muda ao passar pelo campo.
    assert.equal(aoSair, naTela, `texto de ${doBanco} mudou só por abrir o campo`);
    // E reexibir o número relido devolve o mesmo texto de antes.
    assert.equal(formatBRL(numero), naTela);
  }
});

test("Saldos: salvar um saldo já lançado sem alterá-lo grava o mesmo número", () => {
  const { numero } = reabrirESair("1234567.89");
  const [linha] = linhasParaLancamento({
    contas: [{ id: 7 }],
    valores: { 7: numero },
    data: "2026-09-03",
  });
  assert.equal(linha.valor_saldo, MILHAO);
  assert.equal(paraNumeroMoeda(numero), MILHAO);
});

test("Contas bancárias: reabrir o saldo inicial cadastrado não altera o valor", () => {
  const { numero } = reabrirESair("1234567.89");
  assert.equal(saldoInicialInformado(numero), true);
  const conferencia = validarCadastroConta({
    secretaria_id: "1",
    banco_id: "2",
    nome_conta: "FPM",
    numero_conta: "1234-5",
    tipo_conta: "movimento",
    saldo_inicial: numero,
    exigirSaldoInicial: true,
  });
  assert.deepEqual(conferencia.erros, {});
  assert.equal(paraNumeroMoeda(numero), MILHAO);
});

test("Programação: reabrir e salvar sem mexer preserva valor e total", () => {
  // Programação já gravada, relida do banco como a tela relê (numero()).
  const pagamentos = [
    { id: "p1", valor_a_pagar: paraNumeroMoeda("1234567.89") },
    { id: "p2", valor_a_pagar: paraNumeroMoeda("300.00") },
  ];
  const totalAntes = somarPagamentos(pagamentos);

  // O usuário passa pelos dois campos sem digitar nada e salva.
  const depois = pagamentos.reduce(
    (lista, pagamento) => definirValorProgramado(lista, pagamento, reabrirESair(pagamento.valor_a_pagar).numero),
    pagamentos,
  );

  assert.deepEqual(depois.map((p) => p.valor_a_pagar), [MILHAO, 300]);
  assert.equal(somarPagamentos(depois), totalAntes);
  assert.equal(somarPagamentos(depois), 1234867.89);
});

test("Baixa: reabrir o valor em aberto e confirmar abate o mesmo número", () => {
  const nota = { id: "n1", valor: paraNumeroMoeda("1234567.89"), valor_pago: 0, situacao: "em_aberto" };
  const resumo = resumoBaixas(nota.valor, []);
  // O modal já abre com o saldo em aberto no campo; o usuário só confirma.
  const { numero } = reabrirESair(resumo.saldoEmAberto);

  assert.equal(numero, MILHAO);
  assert.deepEqual(validarValorBaixa(numero, resumo.saldoEmAberto), { ok: true });
  assert.equal(centavos(numero), MILHAO);
  // Quitação exata: a nota fecha pelo valor que já estava gravado.
  assert.equal(situacaoAposBaixa(nota, numero), "pago");
});

test("Transferência: reabrir o valor da perna não muda o que é enviado", () => {
  const origens = [{ conta: { id: "o1", saldo: 3000000, secretaria_id: "s1" }, valor: paraNumeroMoeda("1234567.89") }];
  const reaberto = origens.map((linha) => ({ ...linha, valor: reabrirESair(linha.valor).numero }));

  assert.deepEqual(pernasParaEnvio(reaberto), [{ sourceAccountId: "o1", amount: MILHAO }]);
  const conferencia = conferirTransferenciaMultipla({
    destino: { id: "d1", saldo: 100, secretaria_id: "s1" },
    origens: reaberto,
  });
  assert.equal(conferencia.totalTransferir, MILHAO);
  assert.equal(conferencia.patrimonioPreservado, true);
});

test("Fornecedores: reabrir a nota e salvar sem alterar preserva bruto e base", () => {
  // A tela guarda o texto do campo; é dele que sai o número no salvamento.
  const { aoSair } = reabrirESair("1234567.89");
  const formValor = { valor_bruto: aoSair, base_calculo: "" };

  const bruto = paraNumeroMoeda(formValor.valor_bruto);
  const base = paraNumeroMoeda(formValor.base_calculo || formValor.valor_bruto);
  assert.equal(bruto, MILHAO);
  assert.equal(base, MILHAO);
  assert.equal(typeof bruto, "number");
});

// ---------------------------------------------------------------------------
// Totalizadores
// ---------------------------------------------------------------------------

test("os totalizadores continuam batendo com a soma dos valores individuais", () => {
  const contas = [
    { id: "c1", saldo: paraNumeroMoeda("629746.73") },
    { id: "c2", saldo: paraNumeroMoeda("10000.00") },
  ];
  const pagamentos = [
    { id: "p1", valor_a_pagar: paraNumeroMoeda("194631.04") },
    { id: "p2", valor_a_pagar: paraNumeroMoeda("300.00") },
    { id: "p3", valor_a_pagar: paraNumeroMoeda("0.05") },
  ];

  const totalContas = somarContasSelecionadas(contas, new Set(["c1", "c2"]));
  const totalProgramado = somarPagamentos(pagamentos);
  const restante = calcularRestante(totalContas, totalProgramado);

  assert.equal(totalContas, 639746.73);
  assert.equal(totalProgramado, 194931.09);
  assert.equal(restante, 444815.64);

  // O que a tela mostra: cada linha formatada e o total formatado. A soma dos
  // números exibidos é exatamente o número do totalizador -- nada de centavo
  // perdido na formatação.
  const somaDosExibidos = pagamentos.reduce((soma, p) => soma + paraNumeroMoeda(formatBRL(p.valor_a_pagar)), 0);
  assert.equal(valorPlanejamento(somaDosExibidos), totalProgramado);
  assert.equal(semEspacoEstreito(formatBRL(totalProgramado)), "R$ 194.931,09");
  assert.equal(semEspacoEstreito(formatBRL(totalContas)), "R$ 639.746,73");
  assert.equal(semEspacoEstreito(formatBRL(restante)), "R$ 444.815,64");
});
