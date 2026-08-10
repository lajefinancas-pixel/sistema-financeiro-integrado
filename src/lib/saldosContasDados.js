// Consultas de saldo das contas bancárias.
//
// Este é o único lugar que busca saldo no banco: Painel Principal, Saldos das
// Contas, Pagamentos Diários e o diagnóstico de pagamentos chamam daqui, para
// que nenhuma tela tenha uma conta de saldo própria (e diferente das outras).
//
// Duas cautelas importantes:
//
//  1. Consulta paginada. O PostgREST devolve no máximo 1000 linhas por
//     consulta. Um histórico de saldos com mais de 1000 lançamentos fazia a
//     tela receber só um pedaço dele -- e contas cujo último saldo ficava fora
//     do pedaço entravam no total como zero. Aqui a busca vai até o fim.
//
//  2. Agregação antes da soma. Rateios e movimentações são reduzidos a mapas
//     por programação + conta ANTES de encostar na conta, então uma conta com
//     muitos pagamentos vinculados nunca é contada mais de uma vez.

import { supabase } from "./supabaseClient";
import { agregarReservas, montarSaldosDasContas, saldoRealPorConta } from "./saldosContas";

const TAMANHO_PAGINA = 1000;
const MAXIMO_PAGINAS = 200; // trava de segurança contra laço infinito
// Acima disso, filtrar por conta na URL fica maior que buscar tudo e filtrar aqui.
const MAXIMO_IDS_NO_FILTRO = 150;

/**
 * Falhas que significam "esta parte da estrutura ainda não existe no banco",
 * e não um erro de quem está usando o sistema.
 */
export function estruturaDeRateioAusente(erro) {
  const codigo = String(erro?.code ?? "");
  if (["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(codigo)) return true;
  return /schema cache/i.test(String(erro?.message ?? ""));
}

/** Executa a consulta em páginas de 1000 linhas até trazer tudo. */
export async function buscarPaginado(montarConsulta) {
  const todas = [];
  for (let pagina = 0; pagina < MAXIMO_PAGINAS; pagina++) {
    const inicio = pagina * TAMANHO_PAGINA;
    const { data, error } = await montarConsulta().range(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) throw error;
    const linhas = data ?? [];
    todas.push(...linhas);
    if (linhas.length < TAMANHO_PAGINA) break;
  }
  return todas;
}

function filtrarPorConta(consulta, contaIds) {
  const ids = (contaIds ?? []).map(String);
  if (ids.length === 0 || ids.length > MAXIMO_IDS_NO_FILTRO) return consulta;
  return consulta.in("conta_id", ids);
}

/**
 * Saldo Real de cada conta: o último lançamento de saldos_historico, um por
 * conta. `ate` limita a consulta a uma data (visão histórica da tela de Saldos).
 */
export async function buscarSaldoRealPorConta({ contaIds, ate } = {}) {
  const linhas = await buscarPaginado(() => {
    let consulta = supabase
      .from("saldos_historico")
      .select("conta_id, valor_saldo, data_saldo")
      .order("conta_id", { ascending: true })
      .order("data_saldo", { ascending: false });
    if (ate) consulta = consulta.lte("data_saldo", ate);
    return filtrarPorConta(consulta, contaIds);
  });
  return saldoRealPorConta(linhas);
}

/**
 * Valor Reservado de cada conta: o rateio das programações que ainda não virou
 * débito. `programacaoIds` restringe o cálculo a algumas programações (a tela
 * de Pagamentos Diários usa as do dia); sem ele, considera todas.
 *
 * Devolve `rateioIndisponivel: true` quando o banco do ambiente ainda não tem a
 * estrutura de rateio -- nesse caso não há reserva a considerar e as telas
 * seguem mostrando o Saldo Real.
 */
export async function buscarReservasPorConta({ programacaoIds } = {}) {
  const ids = programacaoIds ? programacaoIds.map(String) : null;
  if (ids && ids.length === 0) {
    return { reservas: new Map(), rateioIndisponivel: false };
  }

  try {
    const linhasRateio = await buscarPaginado(() => {
      let consulta = supabase
        .from("programacao_contas")
        .select("programacao_id, conta_id, valor_rateado, ordem")
        .order("programacao_id", { ascending: true })
        .order("conta_id", { ascending: true });
      if (ids) consulta = consulta.in("programacao_id", ids);
      return consulta;
    });

    const movimentacoes = await buscarPaginado(() => {
      let consulta = supabase
        .from("pagamento_movimentacoes")
        .select("programacao_id, conta_id, valor")
        .order("programacao_id", { ascending: true })
        .order("conta_id", { ascending: true });
      if (ids) consulta = consulta.in("programacao_id", ids);
      return consulta;
    });

    return {
      reservas: agregarReservas({ linhasRateio, movimentacoes }),
      rateioIndisponivel: false,
    };
  } catch (e) {
    if (estruturaDeRateioAusente(e)) {
      return { reservas: new Map(), rateioIndisponivel: true };
    }
    throw e;
  }
}

/**
 * Saldo completo das contas informadas: Saldo Real, Valor Reservado e Saldo
 * Disponível, uma linha por conta.
 *
 * @param contas [{ id, ... }] as contas que a tela já carregou
 * @param ate data limite do Saldo Real (visão histórica)
 * @param programacaoIds programações consideradas na reserva (todas, se omitido)
 * @param programacaoAtualId programação aberta na tela, cuja própria reserva
 *        não desconta do disponível (Pagamentos Diários)
 * @param comReservas false quando a tela só precisa do Saldo Real
 */
export async function carregarSaldosDasContas({
  contas,
  ate,
  programacaoIds,
  programacaoAtualId,
  comReservas = true,
} = {}) {
  const lista = contas ?? [];
  const contaIds = lista.map((c) => c.id ?? c.conta_id ?? c.contaId);

  const saldos = await buscarSaldoRealPorConta({ contaIds, ate });
  const { reservas, rateioIndisponivel } = comReservas
    ? await buscarReservasPorConta({ programacaoIds })
    : { reservas: new Map(), rateioIndisponivel: false };

  return {
    contas: montarSaldosDasContas(lista, { saldos, reservas, programacaoAtualId }),
    saldos,
    reservas,
    rateioIndisponivel,
  };
}
