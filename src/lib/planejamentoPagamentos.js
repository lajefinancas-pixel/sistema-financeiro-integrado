import { paraNumeroMoeda } from "./moeda.js";

export function valorPlanejamento(valor) {
  return Math.round(paraNumeroMoeda(valor) * 100) / 100;
}

export function alternarSelecao(idsSelecionados, id) {
  const proximo = new Set(idsSelecionados);
  if (proximo.has(id)) proximo.delete(id);
  else proximo.add(id);
  return proximo;
}

export function selecionarTodosVisiveis(idsSelecionados, idsVisiveis) {
  const proximo = new Set(idsSelecionados);
  const todosMarcados = idsVisiveis.length > 0 && idsVisiveis.every((id) => proximo.has(id));
  idsVisiveis.forEach((id) => todosMarcados ? proximo.delete(id) : proximo.add(id));
  return proximo;
}

export function somarContasSelecionadas(contas, idsSelecionados) {
  return valorPlanejamento(contas.filter((conta) => idsSelecionados.has(conta.id)).reduce((total, conta) => total + valorPlanejamento(conta.saldo), 0));
}

export function somarPagamentos(pagamentos) {
  return valorPlanejamento(pagamentos.reduce((total, pagamento) => total + valorPlanejamento(pagamento.valor_a_pagar), 0));
}

export function calcularRestante(saldo, totalProgramado) {
  return valorPlanejamento(valorPlanejamento(saldo) - valorPlanejamento(totalProgramado));
}

export function definirValorProgramado(pagamentos, pagamentoAlvo, valor) {
  return pagamentos.map((pagamento) => pagamento === pagamentoAlvo ? { ...pagamento, valor_a_pagar: valorPlanejamento(valor) } : pagamento);
}
