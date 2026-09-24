import { chavesDeExibicaoDosPagamentos } from "./planejamentoPagamentos.js";
import { ordenarPagamentosPorNome } from "./nomesFornecedor.js";

/**
 * Monta as linhas da Proposta sem separar rótulos e valores.
 *
 * Cada linha carrega o próprio registro de pagamento. Assim, ordenar para
 * exibição nunca permite que o nome de um item seja combinado com o valor de
 * outro por posição, inclusive depois de uma edição ou de uma recarga.
 */
export function linhasDaProposta(pagamentos = []) {
  const itens = pagamentos ?? [];
  const chaves = chavesDeExibicaoDosPagamentos(itens);

  return ordenarPagamentosPorNome(itens).map((pagamento, indice) => ({
    chave: chaves.get(pagamento) ?? `pos:${indice}`,
    pagamento,
  }));
}
