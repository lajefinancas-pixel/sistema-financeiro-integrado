// Informações técnicas exibidas na categoria SISTEMA das Configurações.
//
// Tudo aqui é somente leitura: nenhuma função deste arquivo grava, altera ou
// apaga qualquer registro. São quatro respostas simples — qual versão está no ar,
// quando ela foi publicada, se o banco está respondendo e quantas pessoas têm
// acesso ativo.

import { supabase } from "./supabaseClient";
import { mensagemAmigavel } from "./erros";

/** Versão do sistema. Valor informativo, atualizado a cada entrega maior. */
export const VERSAO_SISTEMA = "1.0";

/**
 * Dados carimbados no momento em que a aplicação foi compilada (vite.config.js).
 *
 * `data` é o instante da publicação — na prática, quando o commit mais recente
 * entrou no ar. `commit` só existe quando a publicação vem da esteira da Netlify,
 * que expõe a referência do commit para o build; em desenvolvimento fica vazio.
 */
const BUILD = {
  data: import.meta.env.VITE_SISTEMA_PUBLICACAO ?? "",
  commit: import.meta.env.VITE_SISTEMA_COMMIT ?? "",
};

/** "11/08/2026 às 14:32", ou vazio quando o carimbo não veio no build. */
export function dataDaPublicacao() {
  const iso = BUILD?.data ?? null;
  if (!iso) return "";
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  return data
    .toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(", ", " às ");
}

/** Sete primeiros caracteres do commit publicado, quando disponível. */
export function commitPublicado() {
  return String(BUILD?.commit ?? "").trim().slice(0, 7);
}

/**
 * Checagem simples de conexão com o Supabase.
 *
 * Faz a consulta mais barata possível (só a contagem, sem trazer linha nenhuma)
 * em uma tabela que a própria tela já lê. Se responder, o banco está no ar para
 * este usuário; qualquer erro vira "Indisponível" com a explicação ao lado.
 */
export async function verificarBancoDeDados() {
  try {
    const { error } = await supabase
      .from("configuracoes_sistema")
      .select("chave", { count: "exact", head: true });
    if (error) throw error;
    return { conectado: true, detalhe: "O banco de dados respondeu normalmente à consulta." };
  } catch (e) {
    return {
      conectado: false,
      detalhe: mensagemAmigavel(e, "O banco de dados não respondeu à consulta de teste."),
    };
  }
}

/**
 * Quantos usuários estão com acesso ativo.
 *
 * Conta em public.usuarios apenas status = 'ativo' (bloqueados e inativos ficam
 * de fora). Devolve null quando a contagem não pôde ser lida, para a tela dizer
 * "não disponível" em vez de mostrar zero como se fosse a resposta certa.
 */
export async function contarUsuariosAtivos() {
  const { count, error } = await supabase
    .from("usuarios")
    .select("id", { count: "exact", head: true })
    .eq("status", "ativo");
  if (error) return null;
  return count ?? 0;
}

/**
 * Tudo o que a categoria Sistema mostra, em uma chamada só.
 *
 * @returns { versao, publicacao, commit, banco: { conectado, detalhe }, usuariosAtivos }
 */
export async function carregarInformacoesSistema() {
  const [banco, usuariosAtivos] = await Promise.all([
    verificarBancoDeDados(),
    contarUsuariosAtivos().catch(() => null),
  ]);

  return {
    versao: VERSAO_SISTEMA,
    publicacao: dataDaPublicacao(),
    commit: commitPublicado(),
    banco,
    usuariosAtivos,
  };
}
