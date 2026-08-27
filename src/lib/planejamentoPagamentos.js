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

/**
 * Ordem da lista de fornecedores enquanto ela está aberta: primeiro quem tem
 * valor em aberto, do maior para o menor; quem está com R$ 0,00 vai para o fim,
 * em ordem alfabética. Aqui só se ordena -- nenhum valor é recalculado.
 */
export function ordenarFornecedoresPorAberto(fornecedores) {
  return [...fornecedores].sort((a, b) => {
    const abertoA = valorPlanejamento(a.valor_em_aberto);
    const abertoB = valorPlanejamento(b.valor_em_aberto);
    if ((abertoA > 0) !== (abertoB > 0)) return abertoA > 0 ? -1 : 1;
    if (abertoA !== abertoB) return abertoB - abertoA;
    return String(a.razao_social ?? "").localeCompare(String(b.razao_social ?? ""), "pt-BR");
  });
}
