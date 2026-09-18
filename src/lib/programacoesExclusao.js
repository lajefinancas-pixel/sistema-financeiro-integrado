import { supabase } from "./supabaseClient";

export async function verificarExclusaoProgramacao(programacaoId) {
  const { data, error } = await supabase.rpc("verificar_exclusao_programacao", {
    p_programacao_id: Number(programacaoId),
  });
  if (error) throw error;
  return data ?? { tem_pagamento_pago: false };
}

export async function excluirProgramacao(programacaoId, motivo) {
  const { data, error } = await supabase.rpc("excluir_programacao_pagamento", {
    p_programacao_id: Number(programacaoId),
    p_motivo: String(motivo ?? "").trim(),
  });
  if (error) throw error;
  return data;
}

export async function cancelarProgramacao(programacaoId, motivo) {
  const { data, error } = await supabase.rpc("cancelar_programacao_pagamento", {
    p_programacao_id: Number(programacaoId),
    p_motivo: String(motivo ?? "").trim(),
  });
  if (error) throw error;
  return data;
}
