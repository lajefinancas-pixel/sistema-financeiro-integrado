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
  { id: "executar_transferencia", label: "Executar transferência entre contas" },
  { id: "estornar_transferencia", label: "Cancelar/estornar transferência" },
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
