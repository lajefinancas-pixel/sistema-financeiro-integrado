import React from "react";
import { supabase } from "./supabaseClient";

export const ACOES_ESPECIAIS = [
  { id: "visualizar_dados_bancarios", label: "Visualizar dados bancários dos fornecedores" },
  { id: "cadastrar_dados_bancarios", label: "Cadastrar dados bancários" },
  { id: "editar_dados_bancarios", label: "Editar dados bancários" },
  { id: "excluir_dados_bancarios", label: "Excluir dados bancários" },
  { id: "visualizar_pix", label: "Visualizar PIX" },
  { id: "cadastrar_pix", label: "Cadastrar PIX" },
  { id: "editar_pix", label: "Editar PIX" },
  // Execução financeira da programação diária (Fase 2 dos Pagamentos
  // Diários). Aprovar e definir a conta de um pagamento NÃO movimentam saldo;
  // a transferência entre contas confirmada é a única operação da etapa que
  // move dinheiro, e por isso tem permissão própria para executar e outra,
  // separada, para estornar.
  { id: "aprovar_programacao", label: "Aprovar programação de pagamento" },
  { id: "executar_programacao", label: "Executar programação aprovada" },
  { id: "definir_conta_pagamento", label: "Definir conta de pagamento" },
  { id: "executar_transferencia", label: "Transferir entre contas" },
  { id: "estornar_transferencia", label: "Estornar transferência" },
  { id: "visualizar_baixas", label: "Visualizar baixas" },
  { id: "registrar_baixa", label: "Registrar baixa" },
  { id: "registrar_baixa_avulsa", label: "Registrar baixa avulsa (sem programação)" },
  { id: "editar_baixa", label: "Editar baixa" },
  { id: "estornar_baixa", label: "Estornar baixa" },
];

export function usePermissoesEspeciais() {
  const [estado, setEstado] = React.useState({ carregando: true, valores: {} });
  React.useEffect(() => {
    let ativo = true;
    Promise.all(ACOES_ESPECIAIS.map(async ({ id }) => {
      const { data } = await supabase.rpc("tem_permissao_especial", { p_acao: id });
      return [id, data === true];
    })).then((pares) => {
      if (ativo) setEstado({ carregando: false, valores: Object.fromEntries(pares) });
    });
    return () => { ativo = false; };
  }, []);
  return estado;
}

export async function carregarPermissoesEspeciaisUsuario(usuarioId) {
  const { data, error } = await supabase.from("permissoes_especiais").select("acao,permitido").eq("usuario_id", usuarioId);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((item) => [item.acao, item.permitido === true]));
}

export async function salvarPermissoesEspeciaisUsuario(usuarioId, valores, atualizadoPor) {
  const linhas = ACOES_ESPECIAIS.map(({ id }) => ({ usuario_id: usuarioId, acao: id, permitido: valores[id] === true, atualizado_por: atualizadoPor }));
  const { error } = await supabase.from("permissoes_especiais").upsert(linhas, { onConflict: "usuario_id,acao" });
  if (error) throw error;
}
