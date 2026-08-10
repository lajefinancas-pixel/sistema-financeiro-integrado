// Fonte única de verdade do saldo das contas bancárias.
//
// Definições que valem em TODAS as telas (Painel Principal, Saldos das Contas,
// Pagamentos Diários e o diagnóstico de pagamentos):
//
//   Saldo Real       = valor efetivo da conta hoje, ou seja, o último saldo
//                      lançado em saldos_historico. Os pagamentos já marcados
//                      como pagos já saíram daqui (a efetivação lança o saldo
//                      novo), então nada é descontado duas vezes.
//   Valor Reservado  = o que as programações rataram para a conta e ainda não
//                      virou débito: max(0, valor_rateado - já debitado). É
//                      exatamente a mesma conta que a função do banco
//                      marcar_pagamento_pago() faz ao validar o saldo.
//   Saldo Disponível = Saldo Real - Valor Reservado.
//
// REGRA ANTI-DUPLICIDADE (motivo deste arquivo existir): nenhuma soma daqui
// percorre linhas de um "join" entre contas e pagamentos. Uma conta com dez
// pagamentos vinculados apareceria dez vezes nesse tipo de consulta e o saldo
// dela entraria dez vezes no total. Aqui os pagamentos, os rateios e os débitos
// são agregados ANTES, em mapas com chave única (conta_id, ou programação +
// conta_id), e só então cada conta -- identificada pelo seu id, uma única vez --
// recebe os totais. Todo total geral passa por `totalizarSaldos`, que também
// ignora repetições na lista de entrada.
//
// Tudo aqui é cálculo puro (sem banco): as consultas ficam em
// ./saldosContasDados.js, que usa estas funções.

import { emCentavos, somar } from "./rateioPagamentos.js";
import { paraNumeroMoeda } from "./moeda.js";

/** Ordem usada pelo banco quando não há `ordem` gravada. */
const ORDEM_MAXIMA = 2147483647;

function chaveDaConta(contaId) {
  return String(contaId);
}

function chaveProgramacaoConta(programacaoId, contaId) {
  return `${String(programacaoId)} ${String(contaId)}`;
}

/**
 * Último (e penúltimo) saldo de cada conta, a partir das linhas de
 * saldos_historico. O resultado tem UMA entrada por conta_id, escolhida pela
 * data mais recente -- independente da ordem em que as linhas chegaram.
 *
 * @param linhas [{ conta_id, valor_saldo, data_saldo }]
 * @returns Map<contaId, { saldoReal, dataSaldo, saldoAnterior, dataAnterior }>
 */
export function saldoRealPorConta(linhas) {
  const mapa = new Map();

  for (const linha of linhas ?? []) {
    const chave = chaveDaConta(linha.conta_id);
    const valor = emCentavos(linha.valor_saldo);
    const data = String(linha.data_saldo ?? "");
    const atual = mapa.get(chave);

    if (!atual) {
      mapa.set(chave, { saldoReal: valor, dataSaldo: data || null, saldoAnterior: null, dataAnterior: null });
      continue;
    }
    if (data === atual.dataSaldo) continue; // mesma data: uma linha só por conta/data
    if (data > String(atual.dataSaldo ?? "")) {
      mapa.set(chave, {
        saldoReal: valor,
        dataSaldo: data || null,
        saldoAnterior: atual.saldoReal,
        dataAnterior: atual.dataSaldo,
      });
      continue;
    }
    if (atual.dataAnterior === null || data > String(atual.dataAnterior)) {
      atual.saldoAnterior = valor;
      atual.dataAnterior = data || null;
    }
  }

  return mapa;
}

/**
 * Débito já efetivado, agregado por programação + conta. É este passo que
 * impede a duplicidade: pagamento_movimentacoes tem uma linha por pagamento e
 * por conta, então a conta aparece várias vezes ali.
 *
 * @param movimentacoes [{ programacao_id, conta_id, valor }]
 * @returns Map<"programacao conta", valor>
 */
export function debitoPorProgramacaoConta(movimentacoes) {
  const mapa = new Map();
  for (const m of movimentacoes ?? []) {
    const chave = chaveProgramacaoConta(m.programacao_id, m.conta_id);
    mapa.set(chave, emCentavos((mapa.get(chave) ?? 0) + paraNumeroMoeda(m.valor)));
  }
  return mapa;
}

/** Débito já efetivado por conta (soma de todas as programações). */
export function debitoPorConta(movimentacoes) {
  const mapa = new Map();
  for (const m of movimentacoes ?? []) {
    const chave = chaveDaConta(m.conta_id);
    mapa.set(chave, emCentavos((mapa.get(chave) ?? 0) + paraNumeroMoeda(m.valor)));
  }
  return mapa;
}

/** Rateio agregado por programação + conta (mesma soma que o banco valida). */
export function rateioPorProgramacaoConta(linhasRateio) {
  const mapa = new Map();
  for (const r of linhasRateio ?? []) {
    const chave = chaveProgramacaoConta(r.programacao_id, r.conta_id);
    const atual = mapa.get(chave);
    mapa.set(chave, {
      programacao: String(r.programacao_id),
      conta: chaveDaConta(r.conta_id),
      rateado: emCentavos((atual?.rateado ?? 0) + paraNumeroMoeda(r.valor_rateado)),
      ordem: atual?.ordem ?? (r.ordem ?? null),
    });
  }
  return mapa;
}

/** Reserva de uma conta em uma programação: o rateio que ainda não virou débito. */
export function reservaAindaNaoDebitada(rateado, debitado) {
  return Math.max(0, emCentavos(paraNumeroMoeda(rateado) - paraNumeroMoeda(debitado)));
}

/**
 * Valor reservado por conta, com o detalhe por programação.
 *
 * @param linhasRateio  [{ programacao_id, conta_id, valor_rateado, ordem }]
 * @param movimentacoes [{ programacao_id, conta_id, valor }]
 * @returns Map<contaId, { valorReservado, debitado, porProgramacao, debitadoPorProgramacao }>
 */
export function agregarReservas({ linhasRateio, movimentacoes } = {}) {
  const rateios = rateioPorProgramacaoConta(linhasRateio);
  const debitos = debitoPorProgramacaoConta(movimentacoes);
  const porConta = new Map();

  const entrada = (contaId) => {
    const chave = chaveDaConta(contaId);
    if (!porConta.has(chave)) {
      porConta.set(chave, {
        valorReservado: 0,
        debitado: 0,
        porProgramacao: {},
        debitadoPorProgramacao: {},
      });
    }
    return porConta.get(chave);
  };

  for (const [chave, item] of rateios) {
    const debitado = debitos.get(chave) ?? 0;
    const reservado = reservaAindaNaoDebitada(item.rateado, debitado);
    const conta = entrada(item.conta);
    conta.porProgramacao[item.programacao] = reservado;
    conta.debitadoPorProgramacao[item.programacao] = debitado;
    conta.valorReservado = emCentavos(conta.valorReservado + reservado);
    conta.debitado = emCentavos(conta.debitado + debitado);
  }

  // Débito sem linha de rateio (pagamento antigo, anterior ao rateio): a conta
  // continua aparecendo, apenas sem reserva.
  for (const [chave, valor] of debitos) {
    if (rateios.has(chave)) continue;
    const [programacao, contaId] = chave.split(" ");
    const conta = entrada(contaId);
    conta.porProgramacao[programacao] = conta.porProgramacao[programacao] ?? 0;
    conta.debitadoPorProgramacao[programacao] = valor;
    conta.debitado = emCentavos(conta.debitado + valor);
  }

  return porConta;
}

/** Lista sem contas repetidas, mantendo a ordem de entrada (a primeira vence). */
export function contasSemRepeticao(contas) {
  const vistas = new Set();
  const lista = [];
  for (const conta of contas ?? []) {
    const chave = chaveDaConta(conta?.id ?? conta?.conta_id ?? conta?.contaId);
    if (chave === "undefined" || vistas.has(chave)) continue;
    vistas.add(chave);
    lista.push(conta);
  }
  return lista;
}

/**
 * Junta conta + saldo real + reserva, uma linha por conta.
 *
 * @param contas lista de contas ({ id, ... })
 * @param saldos Map de `saldoRealPorConta`
 * @param reservas Map de `agregarReservas`
 * @param programacaoAtualId quando informado (tela de Pagamentos Diários), a
 *        reserva DA PRÓPRIA programação sai do cálculo e o que ela já debitou
 *        volta ao disponível -- assim "Saldo disponível" e "Resta" não mudam
 *        quando um pagamento da programação aberta é efetivado.
 */
export function montarSaldosDasContas(contas, { saldos, reservas, programacaoAtualId } = {}) {
  const progAtual = programacaoAtualId === null || programacaoAtualId === undefined
    ? null
    : String(programacaoAtualId);

  return contasSemRepeticao(contas).map((conta) => {
    const chave = chaveDaConta(conta.id ?? conta.conta_id ?? conta.contaId);
    const saldo = saldos?.get(chave);
    const reserva = reservas?.get(chave);

    const saldoReal = emCentavos(saldo?.saldoReal ?? conta.saldoReal ?? conta.saldo ?? 0);
    const reservaTotal = emCentavos(reserva?.valorReservado ?? 0);
    const reservaDaAtual = progAtual ? emCentavos(reserva?.porProgramacao?.[progAtual] ?? 0) : 0;
    const debitadoNaAtual = progAtual ? emCentavos(reserva?.debitadoPorProgramacao?.[progAtual] ?? 0) : 0;
    const valorReservado = emCentavos(reservaTotal - reservaDaAtual);

    return {
      ...conta,
      // `saldo` é o nome que as telas já aprovadas usam para o Saldo Real.
      saldo: saldoReal,
      saldoReal,
      dataSaldo: saldo?.dataSaldo ?? conta.dataSaldo ?? null,
      saldoAnterior: saldo?.saldoAnterior ?? conta.saldoAnterior ?? null,
      valorReservado,
      debitadoNaProgramacaoAtual: debitadoNaAtual,
      saldoDisponivel: emCentavos(saldoReal + debitadoNaAtual - valorReservado),
    };
  });
}

/**
 * Total de um conjunto de contas. Cada conta entra UMA ÚNICA VEZ, pelo id --
 * mesmo que a lista recebida traga a conta repetida.
 */
export function totalizarSaldos(contas) {
  const lista = contasSemRepeticao(contas);
  const saldoReal = somar(lista.map((c) => c.saldoReal ?? c.saldo));
  const valorReservado = somar(lista.map((c) => c.valorReservado));
  return {
    contas: lista.length,
    saldoReal,
    valorReservado,
    saldoDisponivel: emCentavos(saldoReal - valorReservado),
  };
}

/** Ordem em que o banco percorre as contas de uma programação. */
function ordenarComoOBanco(a, b) {
  return (
    (a.ordem ?? ORDEM_MAXIMA) - (b.ordem ?? ORDEM_MAXIMA) ||
    String(a.conta).localeCompare(String(b.conta))
  );
}

/**
 * Débito que DEVERIA acontecer em cada conta ao pagar um pagamento, segundo a
 * lógica correta em vigor: cada conta entra na proporção do seu rateio e a
 * última fecha o arredondamento, de forma que a soma dos débitos seja
 * exatamente o valor do pagamento (nunca o valor integral em cada conta).
 *
 * Réplica fiel de public.marcar_pagamento_pago(): a soma do rateio considera
 * todas as linhas da programação, mas só as contas com rateio positivo são
 * debitadas, na ordem (ordem, conta_id).
 *
 * @returns { esperado: Map<contaId, valor>, somaRateio, semRateio }
 */
export function debitoEsperadoPorConta(valorPagamento, linhasRateio) {
  const valor = emCentavos(valorPagamento);
  const linhas = [...rateioPorProgramacaoConta(
    (linhasRateio ?? []).map((r) => ({ ...r, programacao_id: r.programacao_id ?? "unica" }))
  ).values()];

  const somaRateio = somar(linhas.map((l) => l.rateado));
  const comRateio = linhas.filter((l) => l.rateado > 0).sort(ordenarComoOBanco);
  const esperado = new Map();

  if (somaRateio <= 0 || comRateio.length === 0 || valor <= 0) {
    return { esperado, somaRateio, semRateio: true };
  }

  let atribuido = 0;
  comRateio.forEach((linha, indice) => {
    const ultima = indice === comRateio.length - 1;
    const debito = ultima ? emCentavos(valor - atribuido) : emCentavos((valor * linha.rateado) / somaRateio);
    atribuido = emCentavos(atribuido + debito);
    esperado.set(linha.conta, emCentavos((esperado.get(linha.conta) ?? 0) + debito));
  });

  return { esperado, somaRateio, semRateio: false };
}
