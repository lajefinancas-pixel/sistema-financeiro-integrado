// Verificação da soma dos saldos: 3 contas com valores diferentes, cada uma com
// vários pagamentos vinculados. O total tem de ser a soma exata das 3 contas --
// nunca a conta repetida uma vez por pagamento.
//
// Rodar com: node scripts/verificar-soma-saldos.mjs

import {
  agregarReservas,
  debitoEsperadoPorConta,
  montarSaldosDasContas,
  saldoRealPorConta,
  totalizarSaldos,
} from "../src/lib/saldosContas.js";
import { emCentavos, somar } from "../src/lib/rateioPagamentos.js";

let falhas = 0;
let checagens = 0;

function conferir(descricao, obtido, esperado) {
  checagens++;
  const ok = emCentavos(obtido) === emCentavos(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${descricao} -- obtido ${obtido}, esperado ${esperado}`);
}

function conferirVerdadeiro(descricao, condicao) {
  checagens++;
  if (!condicao) falhas++;
  console.log(`${condicao ? "ok  " : "FALHA"} ${descricao}`);
}

// ---------------------------------------------------------------- dados de teste

const CONTAS = [
  { id: "a1", nome_conta: "Conta A" },
  { id: "b2", nome_conta: "Conta B" },
  { id: "c3", nome_conta: "Conta C" },
];

// Histórico de saldos: mais de um lançamento por conta, fora de ordem, com uma
// linha repetida na mesma data (para provar que a conta não entra duas vezes).
const SALDOS_HISTORICO = [
  { conta_id: "a1", data_saldo: "2026-07-31", valor_saldo: 9000 },
  { conta_id: "b2", data_saldo: "2026-08-05", valor_saldo: 25500.5 },
  { conta_id: "c3", data_saldo: "2026-06-30", valor_saldo: 1000 },
  { conta_id: "a1", data_saldo: "2026-08-05", valor_saldo: 10000 },
  { conta_id: "a1", data_saldo: "2026-08-05", valor_saldo: 10000 },
  { conta_id: "b2", data_saldo: "2026-07-31", valor_saldo: 24000 },
  { conta_id: "c3", data_saldo: "2026-08-01", valor_saldo: 1234.56 },
];

const SALDO_A = 10000;
const SALDO_B = 25500.5;
const SALDO_C = 1234.56;
const TOTAL_EXATO = emCentavos(SALDO_A + SALDO_B + SALDO_C); // 36.735,06

// Rateio das programações. Cada conta aparece em duas programações -- e cada
// programação tem vários pagamentos vinculados.
const RATEIO = [
  { programacao_id: "P1", conta_id: "a1", valor_rateado: 5000, ordem: 1 },
  { programacao_id: "P1", conta_id: "b2", valor_rateado: 5000, ordem: 2 },
  { programacao_id: "P2", conta_id: "a1", valor_rateado: 2000, ordem: 1 },
  { programacao_id: "P2", conta_id: "c3", valor_rateado: 500, ordem: 2 },
  { programacao_id: "P3", conta_id: "b2", valor_rateado: 1000, ordem: 1 },
  { programacao_id: "P3", conta_id: "c3", valor_rateado: 234.56, ordem: 2 },
];

const PAGAMENTOS = [
  { id: "pag1", programacao_id: "P1", valor_a_pagar: 3000, situacao: "pago" },
  { id: "pag2", programacao_id: "P1", valor_a_pagar: 1000, situacao: "pago" },
  { id: "pag3", programacao_id: "P2", valor_a_pagar: 1500, situacao: "programado" },
  { id: "pag4", programacao_id: "P2", valor_a_pagar: 1000, situacao: "programado" },
  { id: "pag5", programacao_id: "P3", valor_a_pagar: 1234.56, situacao: "pago" },
];

// Razão dos débitos já efetivados: uma linha por pagamento e por conta.
const MOVIMENTACOES = [
  { pagamento_id: "pag1", programacao_id: "P1", conta_id: "a1", valor: 1500 },
  { pagamento_id: "pag1", programacao_id: "P1", conta_id: "b2", valor: 1500 },
  { pagamento_id: "pag2", programacao_id: "P1", conta_id: "a1", valor: 500 },
  { pagamento_id: "pag2", programacao_id: "P1", conta_id: "b2", valor: 500 },
  { pagamento_id: "pag5", programacao_id: "P3", conta_id: "b2", valor: 1000 },
  { pagamento_id: "pag5", programacao_id: "P3", conta_id: "c3", valor: 234.56 },
];

// ------------------------------------------------------------------- checagens

console.log("\n1. Saldo Real: uma entrada por conta, pelo lançamento mais recente");
const saldos = saldoRealPorConta(SALDOS_HISTORICO);
conferir("contas no mapa de saldo real", saldos.size, 3);
conferir("saldo real da Conta A", saldos.get("a1").saldoReal, SALDO_A);
conferir("saldo real da Conta B", saldos.get("b2").saldoReal, SALDO_B);
conferir("saldo real da Conta C", saldos.get("c3").saldoReal, SALDO_C);

console.log("\n2. Total geral = soma exata das 3 contas (sem duplicar por pagamento)");
const reservas = agregarReservas({ linhasRateio: RATEIO, movimentacoes: MOVIMENTACOES });
const contas = montarSaldosDasContas(CONTAS, { saldos, reservas });
const total = totalizarSaldos(contas);
conferir("contas somadas", total.contas, 3);
conferir("total do Saldo Real", total.saldoReal, TOTAL_EXATO);

// Como seria a soma errada: percorrendo as linhas de rateio/pagamento, a conta
// entra uma vez por pagamento vinculado.
const somaDuplicada = somar(
  RATEIO.map((r) => saldos.get(String(r.conta_id)).saldoReal)
);
conferirVerdadeiro(
  `a soma por linha de pagamento daria ${somaDuplicada} (duplicada) e o total correto é ${total.saldoReal}`,
  emCentavos(somaDuplicada) !== emCentavos(total.saldoReal) && emCentavos(total.saldoReal) === TOTAL_EXATO
);

console.log("\n3. Contas repetidas na entrada não inflam o total");
const listaComRepeticao = [...CONTAS, ...CONTAS, CONTAS[0], CONTAS[2]];
const totalComRepeticao = totalizarSaldos(
  montarSaldosDasContas(listaComRepeticao, { saldos, reservas })
);
conferir("total com a lista repetida 3x", totalComRepeticao.saldoReal, TOTAL_EXATO);
conferir("contas somadas com a lista repetida", totalComRepeticao.contas, 3);

console.log("\n4. Valor Reservado e Saldo Disponível por conta");
const porId = new Map(contas.map((c) => [c.id, c]));
conferir("reservado da Conta A (P1 pendente 3.000 + P2 2.000)", porId.get("a1").valorReservado, 5000);
conferir("reservado da Conta B (P1 pendente 3.000, P3 já debitado)", porId.get("b2").valorReservado, 3000);
conferir("reservado da Conta C (P2 500, P3 já debitado)", porId.get("c3").valorReservado, 500);
conferir("disponível da Conta A", porId.get("a1").saldoDisponivel, SALDO_A - 5000);
conferir("disponível da Conta B", porId.get("b2").saldoDisponivel, SALDO_B - 3000);
conferir("disponível da Conta C", porId.get("c3").saldoDisponivel, SALDO_C - 500);
conferir("total reservado", total.valorReservado, 8500);
conferir("total disponível = real - reservado", total.saldoDisponivel, TOTAL_EXATO - 8500);

console.log("\n5. Programação aberta (Pagamentos Diários): o que ela já debitou volta ao disponível");
const contasNaP1 = montarSaldosDasContas(CONTAS, { saldos, reservas, programacaoAtualId: "P1" });
const naP1 = new Map(contasNaP1.map((c) => [c.id, c]));
conferir("reservado da Conta A fora da P1", naP1.get("a1").valorReservado, 2000);
conferir("disponível da Conta A dentro da P1", naP1.get("a1").saldoDisponivel, 10000);
conferir("total do Saldo Real não muda dentro da P1", totalizarSaldos(contasNaP1).saldoReal, TOTAL_EXATO);

console.log("\n6. Débito correto de cada pagamento soma exatamente o valor do pagamento");
for (const pagamento of PAGAMENTOS) {
  const linhas = RATEIO.filter((r) => r.programacao_id === pagamento.programacao_id);
  const { esperado } = debitoEsperadoPorConta(pagamento.valor_a_pagar, linhas);
  const soma = somar([...esperado.values()]);
  conferir(`soma dos débitos de ${pagamento.id}`, soma, pagamento.valor_a_pagar);
  conferirVerdadeiro(
    `nenhuma conta é debitada pelo valor integral de ${pagamento.id}`,
    [...esperado.values()].every((v) => emCentavos(v) < emCentavos(pagamento.valor_a_pagar))
  );
}

console.log("\n7. Valor que não divide igual: o arredondamento fecha na última conta");
const rateioIgual = [
  { programacao_id: "P9", conta_id: "a1", valor_rateado: 1000, ordem: 1 },
  { programacao_id: "P9", conta_id: "b2", valor_rateado: 1000, ordem: 2 },
  { programacao_id: "P9", conta_id: "c3", valor_rateado: 1000, ordem: 3 },
];
const { esperado: tresContas } = debitoEsperadoPorConta(1000.01, rateioIgual);
conferir("soma dos débitos de 1.000,01 em 3 contas", somar([...tresContas.values()]), 1000.01);
conferirVerdadeiro(
  "as 3 contas foram debitadas",
  tresContas.size === 3 && [...tresContas.values()].every((v) => v > 0)
);

console.log(`\n${checagens - falhas}/${checagens} checagens ok`);
if (falhas > 0) {
  console.error(`${falhas} checagem(ns) falharam.`);
  process.exit(1);
}
console.log("Soma dos saldos confere: o total é a soma exata das contas, sem duplicidade.");
