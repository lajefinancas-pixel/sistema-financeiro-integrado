export const FORMA_PAGAMENTO_PADRAO = "dados_bancarios_pix";
export const FORMA_PAGAMENTO_BOLETO = "boleto";

export function somenteDigitos(valor) {
  return String(valor ?? "").replace(/\D/g, "").slice(0, 48);
}

export function formatarCodigoBoleto(valor) {
  return somenteDigitos(valor).replace(/(.{5})/g, "$1 ").trim();
}

export function boletoValido(valor) {
  return [44, 47, 48].includes(somenteDigitos(valor).length);
}

export function formaPagamentoDoProcesso(processo) {
  return processo?.forma_pagamento === FORMA_PAGAMENTO_BOLETO
    ? FORMA_PAGAMENTO_BOLETO
    : FORMA_PAGAMENTO_PADRAO;
}
