import { supabase } from "./supabaseClient";
export { calcularConferenciaTransferencias } from "./regrasTransferencia";

export async function confirmarTransferencias(payload) {
  const { data } = await supabase.auth.getSession();
  const response = await fetch("/api/account-transfers", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token || ""}` },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Não foi possível confirmar as transferências.");
  return body;
}

export function estornarTransferencia(transferId, note) {
  return confirmarTransferencias({ action: "reverse", transferId, note });
}
