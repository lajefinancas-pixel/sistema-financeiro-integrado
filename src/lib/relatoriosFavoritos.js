import { supabase } from "./supabaseClient";
import { erroAmigavel, mensagemAmigavel } from "./erros";

// Relatórios personalizados salvos pelo usuário (tabela public.relatorios_favoritos,
// criada pela migration 20260811120000_relatorios_favoritos.sql).
// A RLS já limita cada usuário aos próprios registros, por isso a leitura não
// precisa repetir o filtro por usuário.
const TABELA = "relatorios_favoritos";

async function usuarioLogadoId() {
  const { data } = await supabase.auth.getUser();
  const id = data?.user?.id;
  if (!id) throw erroAmigavel("Sessão expirada. Entre novamente para salvar relatórios.");
  return id;
}

/** Relatórios salvos do usuário logado, do mais recente para o mais antigo. */
export async function listarRelatoriosFavoritos() {
  const { data, error } = await supabase
    .from(TABELA)
    .select("id, nome, configuracao, criado_em")
    .order("criado_em", { ascending: false });
  if (error) {
    throw erroAmigavel(
      mensagemAmigavel(
        error,
        "Não foi possível carregar seus relatórios salvos. O construtor continua disponível."
      )
    );
  }
  return data ?? [];
}

/** Grava a configuração atual do construtor com o nome escolhido. */
export async function salvarRelatorioFavorito(nome, configuracao) {
  const rotulo = String(nome ?? "").trim();
  if (!rotulo) throw erroAmigavel("Dê um nome para o relatório antes de salvar.");

  const usuario_id = await usuarioLogadoId();
  const { data, error } = await supabase
    .from(TABELA)
    .insert({ usuario_id, nome: rotulo, configuracao })
    .select("id, nome, configuracao, criado_em")
    .single();

  if (error) {
    if (error.code === "23505") throw erroAmigavel("Você já tem um relatório salvo com esse nome.");
    throw erroAmigavel(mensagemAmigavel(error, "Não foi possível salvar o relatório."));
  }
  return data;
}

export async function excluirRelatorioFavorito(id) {
  const { error } = await supabase.from(TABELA).delete().eq("id", id);
  if (error) throw erroAmigavel(mensagemAmigavel(error, "Não foi possível excluir o relatório salvo."));
}
