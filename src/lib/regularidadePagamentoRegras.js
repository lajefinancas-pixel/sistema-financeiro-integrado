import { resumoDocumental } from "./certidoesRegras.js";

/** Regra pura compartilhada pela listagem e pela confirmação da baixa. */
export function regularidadeDoFornecedor(certidoes = [], formasPagamento = []) {
  const documental = resumoDocumental(certidoes);
  const temDadosPagamento = Array.isArray(formasPagamento)
    ? formasPagamento.length > 0
    : formasPagamento === true;
  const avisos = [];
  if (["sem_cadastro", "vencida"].includes(documental.tom)) avisos.push(documental.texto);
  if (!temDadosPagamento) avisos.push("Dados para pagamento pendentes");
  return { documental, temDadosPagamento, avisos, pendente: avisos.length > 0 };
}
