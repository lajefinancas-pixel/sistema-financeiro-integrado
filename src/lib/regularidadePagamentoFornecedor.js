import { listarCertidoesDoFornecedor } from "./certidoes.js";
import { listarFormasPagamento, resumirDadosPagamentoFornecedores } from "./dadosPagamentoFornecedor.js";
import { regularidadeDoFornecedor } from "./regularidadePagamentoRegras.js";

export { regularidadeDoFornecedor } from "./regularidadePagamentoRegras.js";

export async function consultarRegularidadePagamento(fornecedorId) {
  if (!fornecedorId) return regularidadeDoFornecedor();
  const [certidoes, formas] = await Promise.all([
    listarCertidoesDoFornecedor(fornecedorId),
    listarFormasPagamento(fornecedorId),
  ]);
  return regularidadeDoFornecedor(certidoes, formas ?? []);
}

export async function consultarRegularidadesPagamento(fornecedorIds) {
  const ids = [...new Set((fornecedorIds ?? []).filter(Boolean).map(String))];
  if (!ids.length) return {};
  const [certidoes, pagamentos] = await Promise.all([
    Promise.all(ids.map(async (id) => [id, await listarCertidoesDoFornecedor(id)])),
    resumirDadosPagamentoFornecedores(ids),
  ]);
  return Object.fromEntries(certidoes.map(([id, lista]) => [
    id,
    regularidadeDoFornecedor(lista, pagamentos?.[id] ?? []),
  ]));
}
