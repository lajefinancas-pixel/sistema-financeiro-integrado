import { supabase } from "./supabaseClient";
import { partesDeDadosBancarios } from "./dadosBancariosUnificados.js";

async function request(url, options = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Não foi possível acessar os dados para pagamento.");
  }
  return response.status === 204 ? null : response.json();
}

export function listarFormasPagamento(fornecedorId) {
  return request(`/api/supplier-payment-methods?supplierId=${encodeURIComponent(fornecedorId)}`);
}

export function resumirDadosPagamentoFornecedores(fornecedorIds) {
  if (!fornecedorIds.length) return Promise.resolve({});
  return request(`/api/supplier-payment-methods?supplierIds=${encodeURIComponent(fornecedorIds.join(","))}`);
}

export function salvarFormaPagamento(fornecedorId, forma) {
  return request(`/api/supplier-payment-methods?supplierId=${encodeURIComponent(fornecedorId)}`, {
    method: forma.id ? "PATCH" : "POST",
    body: JSON.stringify(forma),
  });
}

export function excluirFormaPagamento(fornecedorId, forma) {
  return request(`/api/supplier-payment-methods?supplierId=${encodeURIComponent(fornecedorId)}`, {
    method: "DELETE",
    body: JSON.stringify(forma),
  });
}

export function resumirFormaPagamento(forma, mascarar = false) {
  if (!forma) return "Dados para pagamento pendentes";
  if (forma.kind === "pix") return mascarar ? "PIX cadastrado" : `PIX — ${forma.pixKeyType || "chave"}${forma.isPrimary ? " — Principal" : ""}`;
  const finalConta = String(forma.account || "").replace(/\D/g, "").slice(-4);
  return mascarar ? "Dados bancários ✓" : `${forma.bankName || "Conta bancária"} — Conta final ${finalConta || "----"}${forma.isPrimary ? " — Principal" : ""}`;
}

/**
 * Grava o FORMULÁRIO ÚNICO de dados bancários (conta e/ou PIX).
 *
 * Um botão, um formulário -- e, por baixo, a gravação de sempre: cada parte
 * preenchida é enviada como o registro que ela já era, com o mesmo `kind` e
 * pela mesma rota, para as permissões separadas e a auditoria por registro
 * continuarem valendo. Parte vazia não é enviada e nada já cadastrado é
 * convertido ou apagado.
 *
 * Os envios são em sequência (e não em paralelo) para que a marcação de
 * principal seja resolvida pelo banco um registro por vez.
 */
export async function salvarDadosBancarios(fornecedorId, formulario) {
  const salvos = [];
  for (const parte of partesDeDadosBancarios(formulario)) {
    salvos.push(await salvarFormaPagamento(fornecedorId, parte));
  }
  return salvos;
}
