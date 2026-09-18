import { supabase } from "./supabaseClient.js";

export async function gerarPdfUnificado({ pdf, fornecedorId, certidoes = [] }) {
  const { data } = await supabase.auth.getSession();
  const bytes = new Uint8Array(pdf.output("arraybuffer"));
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const resposta = await fetch("/api/processos/mesclar-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify({ processoPdfBase64: btoa(binario), fornecedorId, certidoes }),
  });
  if (!resposta.ok) {
    const falha = await resposta.json().catch(() => ({}));
    throw new Error(falha.error || "Não foi possível gerar o PDF único.");
  }
  return resposta.blob();
}

export function abrirPdfSemBaixar(blob) {
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 120000);
}

export function imprimirPdfSemBaixar(blob, janela = null) {
  const url = URL.createObjectURL(blob);
  const destino = janela && !janela.closed ? janela : window.open("", "_blank");
  if (!destino) return abrirPdfSemBaixar(blob);
  destino.location.href = url;
  window.setTimeout(() => {
    try { destino.print(); } catch { /* O visualizador continua aberto para impressão manual. */ }
  }, 1200);
  window.setTimeout(() => URL.revokeObjectURL(url), 120000);
}

export function baixarPdf(blob, nome) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = nome; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
