// Rotina ÚNICA de gravação de saldo em public.saldos_historico.
//
// Existe um só caminho para o saldo entrar no banco, e é este: o lançamento
// diário da tela de Saldos das Contas (em lote ou conta por conta), a
// importação em lote e o saldo inicial informado no cadastro de uma conta nova
// passam todos por aqui. Não há rotina paralela — se a regra do lançamento
// mudar, muda num lugar só.
//
// Regras que valem para qualquer chamada:
//
//   * Uma linha por conta e por data. O conflito (conta_id, data_saldo) é
//     resolvido por upsert, então relançar o mesmo dia corrige o valor daquele
//     dia em vez de duplicar o registro.
//   * Campo vazio NÃO é zero. Só entra no banco a conta cujo valor foi
//     realmente digitado; campo em branco é "não lancei esta conta hoje" e a
//     linha simplesmente não é escrita. É isso que permite limpar os campos da
//     tela sem risco: sem valor digitado, nada é gravado.
//   * Nada é apagado. Datas anteriores nunca são tocadas.

import { supabase } from "./supabaseClient";
import { paraNumeroMoeda } from "./moeda";

// As regras puras (campo preenchido, montagem das linhas) ficam em
// ./lancamentoSaldosRegras.js e são reexportadas aqui: quem usa a tela importa
// tudo de um só lugar.
export { campoPreenchido, linhasParaLancamento } from "./lancamentoSaldosRegras";

/**
 * Grava o saldo das contas informadas. Recebe as linhas já montadas
 * (`linhasParaLancamento` ou uma linha só, no cadastro da conta).
 *
 * Devolve a quantidade de linhas gravadas; com a lista vazia não encosta no
 * banco.
 */
export async function lancarSaldos(linhas) {
  const lista = (linhas ?? []).filter((linha) => linha && linha.conta_id != null && linha.data_saldo);
  if (lista.length === 0) return 0;

  const { error } = await supabase
    .from("saldos_historico")
    .upsert(lista, { onConflict: "conta_id,data_saldo" });
  if (error) throw error;
  return lista.length;
}

/** Lançamento de uma conta só (conta nova com saldo inicial, edição avulsa). */
export async function lancarSaldoDaConta({ contaId, valor, data }) {
  return lancarSaldos([
    { conta_id: contaId, valor_saldo: paraNumeroMoeda(valor), data_saldo: data },
  ]);
}
