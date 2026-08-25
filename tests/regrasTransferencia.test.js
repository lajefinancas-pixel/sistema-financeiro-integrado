import test from "node:test";
import assert from "node:assert/strict";
import { aplicarTransferenciaEmSaldos, calcularConferenciaTransferencias, totalDosSaldos } from "../src/lib/regrasTransferencia.js";

test("calcula a conferência antes da confirmação", () => {
  assert.deepEqual(calcularConferenciaTransferencias({ saldoDestino: 100000, transferencias: [{ valor: 300000 }, { valor: 200000 }], totalPagamentos: 550000 }), {
    totalTransferir: 500000,
    saldoAposTransferencias: 600000,
    restaAposPagamentos: 50000,
    faltaTransferir: 450000,
  });
});

test("transferência preserva a soma geral dos saldos", () => {
  const antes = { a: 300000, b: 200000 };
  const depois = aplicarTransferenciaEmSaldos(antes, "a", "b", 100000);
  assert.deepEqual(depois, { a: 200000, b: 300000 });
  assert.equal(totalDosSaldos(depois), totalDosSaldos(antes));
});

test("transferência não permite saldo negativo", () => {
  assert.throws(() => aplicarTransferenciaEmSaldos({ a: 10, b: 20 }, "a", "b", 11), /Saldo insuficiente/);
});

test("pagamento é comparado somente com a conta concentradora", () => {
  const conferencia = calcularConferenciaTransferencias({ saldoDestino: 100, transferencias: [], totalPagamentos: 120 });
  assert.equal(conferencia.faltaTransferir, 20);
  assert.equal(conferencia.restaAposPagamentos, -20);
});
