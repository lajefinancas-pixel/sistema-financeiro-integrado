import { supabase } from "./supabaseClient.js";
export { secretariasAtivas, somenteFinanceiras } from "./secretariasRegras.js";

export const CAMPOS_SECRETARIA = "id,cadastro_unico_id,nome,nome_curto,secretario,secretario_cpf,secretario_cargo,ativo,possui_financeiro";

export async function listarTodasSecretarias({ incluirInativas = false } = {}) {
  let consulta = supabase.from("secretarias").select(CAMPOS_SECRETARIA).order("nome");
  if (!incluirInativas) consulta = consulta.eq("ativo", true);
  const { data, error } = await consulta;
  if (error) throw error;
  return data ?? [];
}

export async function listarSecretariasFinanceiras() {
  const { data, error } = await supabase
    .from("secretarias")
    .select(CAMPOS_SECRETARIA)
    .eq("ativo", true)
    .eq("possui_financeiro", true)
    .order("nome");
  if (error) throw error;
  return data ?? [];
}

export function idDocumentalDaSecretaria(secretaria) {
  return secretaria?.cadastro_unico_id ?? secretaria?.id ?? null;
}
