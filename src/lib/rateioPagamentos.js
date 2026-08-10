// Rateio dos pagamentos de uma programação entre as contas bancárias escolhidas.
//
// Regra do sistema: o valor total dos pagamentos de uma programação sai das
// contas escolhidas para ela, e a SOMA DO RATEIO tem de ser igual a esse total.
// Nenhuma conta é debitada pelo valor integral do pagamento -- cada uma entrega
// exatamente o que foi rateado para ela.
//
// Tudo aqui é cálculo puro (sem banco), com dinheiro sempre arredondado em
// centavos para que somas de frações não deixem uma diferença invisível na tela.

import { formatBRL, paraNumeroMoeda } from "./moeda.js";

/** Diferença que ainda conta como "igual": meio centavo. */
export const TOLERANCIA = 0.005;

/** Número em centavos fechados (evita 0,30000000000000004 em somas). */
export function emCentavos(valor) {
  return Math.round(paraNumeroMoeda(valor) * 100) / 100;
}

export function somar(valores) {
  return emCentavos((valores ?? []).reduce((acc, v) => acc + paraNumeroMoeda(v), 0));
}

/** A soma do rateio fecha com o total dos pagamentos? */
export function rateioFecha(somaRateio, totalPagamentos) {
  return Math.abs(emCentavos(somaRateio) - emCentavos(totalPagamentos)) < TOLERANCIA;
}

/**
 * Rateio automático: percorre as contas na ordem em que foram escolhidas e
 * preenche cada uma até esgotar o saldo disponível dela antes de passar para a
 * próxima. Nenhuma conta fica negativa; o que não couber volta em `faltante`,
 * para a tela avisar em vez de forçar um débito impossível.
 *
 * @param contas [{ id, disponivel, minimo }] na ordem de escolha. `minimo` é o
 *        que já foi debitado da conta nesta programação e não pode ser desfeito.
 * @param total valor total dos pagamentos da programação.
 */
export function ratearAutomaticamente(contas, total) {
  const lista = contas ?? [];
  const rateio = {};
  let restante = emCentavos(total);

  // O que já foi efetivado na conta é intocável e entra antes de tudo.
  for (const conta of lista) {
    const minimo = Math.max(0, emCentavos(conta.minimo));
    rateio[conta.id] = minimo;
    restante = emCentavos(restante - minimo);
  }

  for (const conta of lista) {
    if (restante <= 0) break;
    const espaco = emCentavos(Math.max(0, emCentavos(conta.disponivel) - rateio[conta.id]));
    if (espaco <= 0) continue;
    const parcela = Math.min(espaco, restante);
    rateio[conta.id] = emCentavos(rateio[conta.id] + parcela);
    restante = emCentavos(restante - parcela);
  }

  return { rateio, faltante: Math.max(0, restante) };
}

/** Texto do bloqueio por saldo insuficiente (item exigido na tela). */
export function textoSaldoInsuficiente(saldoDisponivel, valorProgramado) {
  const diferenca = emCentavos(valorProgramado - saldoDisponivel);
  return (
    "Saldo insuficiente nas contas selecionadas. " +
    `Saldo disponível: ${formatBRL(saldoDisponivel)} · ` +
    `Valor programado: ${formatBRL(valorProgramado)} · ` +
    `Diferença: ${formatBRL(diferenca)}.`
  );
}

/** Texto do bloqueio por rateio que não fecha com o total dos pagamentos. */
export function textoRateioDivergente(somaRateio, totalPagamentos) {
  const diferenca = emCentavos(totalPagamentos - somaRateio);
  return (
    `O rateio precisa fechar com o total dos pagamentos. Soma do rateio: ${formatBRL(somaRateio)} · ` +
    `Total dos pagamentos: ${formatBRL(totalPagamentos)} · ` +
    `Diferença: ${formatBRL(diferenca)}.`
  );
}

/**
 * Motivo devolvido pela efetivação no banco, traduzido para a tela.
 * @param resultado jsonb devolvido por marcar_pagamento_pago
 * @param nomeConta nome da conta citada no motivo, quando houver
 */
export function textoDoMotivo(resultado, nomeConta) {
  const motivo = resultado?.motivo;

  if (motivo === "saldo_insuficiente") {
    return (
      "Saldo insuficiente nas contas selecionadas. " +
      `${nomeConta ? `Conta ${nomeConta} -- ` : ""}` +
      `Saldo disponível: ${formatBRL(resultado.disponivel)} · ` +
      `Valor programado: ${formatBRL(resultado.necessario)} · ` +
      `Diferença: ${formatBRL(resultado.diferenca)}.`
    );
  }

  if (motivo === "rateio_divergente") {
    return textoRateioDivergente(resultado.soma_rateio, resultado.total_pagamentos);
  }

  if (motivo === "sem_contas") {
    return "Escolha as contas bancárias desta programação antes de efetivar o pagamento.";
  }

  if (motivo === "pagamento_cancelado") {
    return "Este pagamento está cancelado e não pode ser efetivado.";
  }

  if (motivo === "valor_invalido") {
    return "Informe um valor maior que zero para efetivar este pagamento.";
  }

  return "Não foi possível efetivar este pagamento. Confira o rateio e os saldos das contas.";
}
