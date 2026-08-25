import { paraNumeroMoeda } from "./moeda.js";

export function situacaoPagamento(valorTotal, totalBaixado) {
  const total = paraNumeroMoeda(valorTotal);
  const baixado = paraNumeroMoeda(totalBaixado);
  if (baixado <= 0) return "em_aberto";
  if (baixado + 0.005 < total) return "parcialmente_pago";
  return "pago";
}

export function resumoBaixas(valorTotal, baixas = []) {
  const total = paraNumeroMoeda(valorTotal);
  const totalBaixado = baixas
    .filter((baixa) => baixa.status === "efetivada")
    .reduce((soma, baixa) => soma + paraNumeroMoeda(baixa.valor_pago), 0);
  return {
    valorTotal: total,
    totalBaixado,
    saldoEmAberto: Math.max(0, total - totalBaixado),
    situacao: situacaoPagamento(total, totalBaixado),
  };
}

export function validarValorBaixa(valor, saldoEmAberto) {
  const numero = paraNumeroMoeda(valor);
  const aberto = paraNumeroMoeda(saldoEmAberto);
  if (numero <= 0) return { ok: false, mensagem: "O valor da baixa deve ser maior que zero." };
  if (numero > aberto + 0.005) return { ok: false, mensagem: `O valor informado supera o saldo em aberto disponível.` };
  return { ok: true };
}
