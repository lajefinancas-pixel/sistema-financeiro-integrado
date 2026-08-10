import { supabase } from "./supabaseClient";

// Filtros favoritos da aba Fornecedores (tabela public.filtros_favoritos, criada
// pela migration 20260810150000_filtros_favoritos_fornecedores.sql).
// A RLS já limita cada usuário aos próprios registros, por isso a leitura não
// precisa repetir o filtro por usuário.
const TABELA = "filtros_favoritos";

async function usuarioLogadoId() {
  const { data } = await supabase.auth.getUser();
  const id = data?.user?.id;
  if (!id) throw new Error("Sessão expirada. Entre novamente para usar os filtros salvos.");
  return id;
}

/** Filtros salvos do usuário logado, do mais recente para o mais antigo. */
export async function listarFiltrosFavoritos() {
  const { data, error } = await supabase
    .from(TABELA)
    .select("id, nome, criterios, criado_em")
    .order("criado_em", { ascending: false });
  if (error) throw new Error(error.message ?? "Não foi possível carregar os filtros salvos.");
  return data ?? [];
}

/** Grava a combinação atual de filtros com o nome escolhido. */
export async function salvarFiltroFavorito(nome, criterios) {
  const rotulo = String(nome ?? "").trim();
  if (!rotulo) throw new Error("Dê um nome para o filtro antes de salvar.");

  const usuario_id = await usuarioLogadoId();
  const { data, error } = await supabase
    .from(TABELA)
    .insert({ usuario_id, nome: rotulo, criterios })
    .select("id, nome, criterios, criado_em")
    .single();

  if (error) {
    if (error.code === "23505") throw new Error("Você já tem um filtro salvo com esse nome.");
    throw new Error(error.message ?? "Não foi possível salvar o filtro.");
  }
  return data;
}

export async function excluirFiltroFavorito(id) {
  const { error } = await supabase.from(TABELA).delete().eq("id", id);
  if (error) throw new Error(error.message ?? "Não foi possível excluir o filtro salvo.");
}
