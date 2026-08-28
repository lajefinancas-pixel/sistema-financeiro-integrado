// Regras puras do lançamento de saldo — o que decide se um campo vira linha no
// banco. Vive separado de ./lancamentoSaldos.js (que fala com o Supabase) só
// para poder ser testado direto, sem cliente de banco.
//
// A regra que sustenta a tela: campo vazio NÃO é zero. Campo em branco significa
// "não lancei esta conta hoje" e nenhuma linha é escrita — é isso que torna
// seguro limpar os campos e abrir a tela em branco por padrão.

import { paraNumeroMoeda } from "./moeda.js";

/**
 * O campo tem valor digitado? Distingue "em branco" (não lançar) de zero
 * (lançar R$ 0,00, que é um saldo legítimo).
 */
export function campoPreenchido(valor) {
  if (valor === null || valor === undefined) return false;
  if (typeof valor === "number") return Number.isFinite(valor);
  return String(valor).trim() !== "";
}

/**
 * Linhas prontas para gravar, a partir do que está na tela.
 *
 * @param contas   [{ id }] as contas exibidas
 * @param valores  { [contaId]: valorDigitado } — o que está nos campos
 * @param data     data do lançamento (ISO, "AAAA-MM-DD")
 * @returns [{ conta_id, valor_saldo, data_saldo }] só das contas preenchidas
 */
export function linhasParaLancamento({ contas, valores, data } = {}) {
  return (contas ?? [])
    .filter((conta) => campoPreenchido(valores?.[conta.id]))
    .map((conta) => ({
      conta_id: conta.id,
      valor_saldo: paraNumeroMoeda(valores[conta.id]),
      data_saldo: data,
    }));
}
