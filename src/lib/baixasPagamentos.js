import { supabase } from "./supabaseClient";
import { paraNumeroMoeda } from "./moeda";
export { resumoBaixas, situacaoPagamento, validarValorBaixa } from "./regrasBaixas";

export async function registrarBaixa(campos) {
  const { data, error } = await supabase.rpc("registrar_baixa_pagamento", {
    p_chave_idempotencia: campos.chaveIdempotencia,
    p_fornecedor_id: String(campos.fornecedorId),
    p_valor: paraNumeroMoeda(campos.valor),
    p_data_pagamento: campos.dataPagamento,
    p_conta_id: campos.contaId,
    p_pagamento_id: campos.pagamentoId ? String(campos.pagamentoId) : null,
    p_documento: campos.documento || null,
    p_observacao: campos.observacao || null,
  });
  if (error) throw error;
  return data;
}

export async function estornarBaixa(baixaId, motivo, chaveIdempotencia = crypto.randomUUID()) {
  const { data, error } = await supabase.rpc("estornar_baixa_pagamento", {
    p_baixa_id: baixaId,
    p_motivo: motivo,
    p_chave_idempotencia: chaveIdempotencia,
  });
  if (error) throw error;
  return data;
}

export async function editarBaixa(baixaId, documento, observacao) {
  const { data, error } = await supabase.rpc("editar_baixa_pagamento", {
    p_baixa_id: baixaId,
    p_documento: documento || null,
    p_observacao: observacao || null,
  });
  if (error) throw error;
  return data;
}

export async function listarBaixas(filtros = {}) {
  let consulta = supabase
    .from("pagamentos_baixas")
    .select("id,chave_idempotencia,fornecedor_id,pagamento_id,valor_total_referencia,valor_pago,data_pagamento,conta_id,documento,observacao,status,saldo_antes,saldo_depois,usuario_id,criado_em,estornada_em,estornada_por,motivo_estorno")
    .order("data_pagamento", { ascending: false })
    .order("criado_em", { ascending: false });
  if (filtros.inicio) consulta = consulta.gte("data_pagamento", filtros.inicio);
  if (filtros.fim) consulta = consulta.lte("data_pagamento", filtros.fim);
  if (filtros.fornecedorId) consulta = consulta.eq("fornecedor_id", String(filtros.fornecedorId));
  if (filtros.contaId) consulta = consulta.eq("conta_id", filtros.contaId);
  if (filtros.pagamentoId) consulta = consulta.eq("pagamento_id", String(filtros.pagamentoId));
  const { data, error } = await consulta;
  if (error) throw error;
  return data ?? [];
}
