import { motivoBloqueioTransferencia } from "./segregacaoSecretarias.js";

export function emCentavosTransferencia(valor) {
  return Math.round((Number(valor) || 0) * 100) / 100;
}

export function calcularConferenciaTransferencias({ saldoDestino = 0, transferencias = [], totalPagamentos = 0 }) {
  const totalTransferir = emCentavosTransferencia(transferencias.reduce((soma, item) => soma + Number(item.valor || 0), 0));
  const saldoAposTransferencias = emCentavosTransferencia(Number(saldoDestino || 0) + totalTransferir);
  return {
    totalTransferir,
    saldoAposTransferencias,
    restaAposPagamentos: emCentavosTransferencia(saldoAposTransferencias - Number(totalPagamentos || 0)),
    faltaTransferir: Math.max(0, emCentavosTransferencia(Number(totalPagamentos || 0) - Number(saldoDestino || 0))),
  };
}

export function aplicarTransferenciaEmSaldos(saldos, origemId, destinoId, valor) {
  const quantia = emCentavosTransferencia(valor);
  if (origemId === destinoId) throw new Error("Origem e destino devem ser diferentes.");
  if (quantia <= 0) throw new Error("Valor inválido.");
  if (Number(saldos[origemId] || 0) < quantia) throw new Error("Saldo insuficiente.");
  return {
    ...saldos,
    [origemId]: emCentavosTransferencia(Number(saldos[origemId] || 0) - quantia),
    [destinoId]: emCentavosTransferencia(Number(saldos[destinoId] || 0) + quantia),
  };
}

export function totalDosSaldos(saldos) {
  return emCentavosTransferencia(Object.values(saldos).reduce((total, valor) => total + Number(valor || 0), 0));
}

// ---------------------------------------------------------------------------
// Transferência entre contas próprias: várias origens para um destino
// ---------------------------------------------------------------------------
// TRANSFERÊNCIA ENTRE CONTAS PRÓPRIAS NÃO É DESPESA. A origem debita, o destino
// credita e o patrimônio total continua igual -- é isso que `totalDosSaldos`
// acima comprova e que a conferência abaixo mostra na tela antes de confirmar.

/**
 * Conferência ao vivo do painel de transferência.
 *
 * Devolve o total a transferir, o saldo atual do destino e o saldo do destino
 * DEPOIS das transferências, além do saldo de cada origem depois do débito e do
 * primeiro impedimento de cada linha (saldo insuficiente, mesma conta,
 * secretaria bloqueada).
 */
export function conferirTransferenciaMultipla({ destino = null, origens = [] } = {}) {
  const saldoDestinoAtual = emCentavosTransferencia(destino?.saldo ?? 0);

  const linhas = origens.map((origem) => {
    const valor = emCentavosTransferencia(origem.valor);
    const saldoAtual = emCentavosTransferencia(origem.conta?.saldo ?? 0);
    let erro = null;
    if (!origem.conta) erro = "Escolha a conta de origem.";
    else if (valor <= 0) erro = "Informe um valor maior que zero.";
    else if (valor > saldoAtual) erro = "Saldo insuficiente nesta conta de origem.";
    else erro = motivoBloqueioTransferencia(origem.conta, destino);

    return {
      ...origem,
      valor,
      saldoAtual,
      saldoDepois: emCentavosTransferencia(saldoAtual - valor),
      erro,
    };
  });

  const totalTransferir = emCentavosTransferencia(
    linhas.reduce((soma, linha) => soma + linha.valor, 0)
  );

  const contagemOrigens = new Map();
  for (const linha of linhas) {
    if (!linha.conta) continue;
    contagemOrigens.set(linha.conta.id, (contagemOrigens.get(linha.conta.id) ?? 0) + 1);
  }
  const repetidas = [...contagemOrigens.entries()].filter(([, vezes]) => vezes > 1).map(([id]) => id);

  const erros = linhas.map((linha) => linha.erro).filter(Boolean);
  if (repetidas.length) erros.push("A mesma conta de origem aparece mais de uma vez.");
  if (!destino) erros.push("Escolha a conta de destino.");
  if (linhas.length === 0) erros.push("Acrescente ao menos uma conta de origem.");

  const totalAntes = emCentavosTransferencia(
    saldoDestinoAtual + linhas.reduce((soma, linha) => soma + linha.saldoAtual, 0)
  );
  const saldoDestinoDepois = emCentavosTransferencia(saldoDestinoAtual + totalTransferir);
  const totalDepois = emCentavosTransferencia(
    saldoDestinoDepois + linhas.reduce((soma, linha) => soma + linha.saldoDepois, 0)
  );

  return {
    linhas,
    origensRepetidas: repetidas,
    totalTransferir,
    saldoDestinoAtual,
    saldoDestinoDepois,
    // Prova na tela de que a transferência não é despesa: o patrimônio somado
    // das contas envolvidas é o mesmo antes e depois.
    patrimonioAntes: totalAntes,
    patrimonioDepois: totalDepois,
    patrimonioPreservado: totalAntes === totalDepois,
    erros: [...new Set(erros)],
    podeConfirmar: erros.length === 0 && totalTransferir > 0,
  };
}

/** Linhas prontas para o corpo da requisição de confirmação. */
export function pernasParaEnvio(origens = []) {
  return origens
    .filter((origem) => origem.conta && emCentavosTransferencia(origem.valor) > 0)
    .map((origem) => ({
      sourceAccountId: origem.conta.id,
      amount: emCentavosTransferencia(origem.valor),
    }));
}
