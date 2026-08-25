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
