import { supabase } from "./supabaseClient";

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
