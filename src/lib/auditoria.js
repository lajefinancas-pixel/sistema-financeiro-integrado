import { supabase } from "./supabaseClient";
import { mensagemAmigavel } from "./erros";

/**
 * Camada de dados da trilha de auditoria (tabela public.auditoria_eventos,
 * criada pela migration 20260811130000_auditoria_eventos.sql).
 *
 * A tabela é somente-inserção e somente-leitura: nenhuma tela altera ou apaga
 * um evento, e a consulta só abre para quem tem pode_visualizar no módulo
 * 'auditoria'.
 *
 * Regra de ouro do registro: auditar NUNCA derruba a ação principal. Se o
 * insert falhar (rede, permissão, tabela ainda não criada no banco),
 * `registrarEvento` devolve uma mensagem e a tela segue como antes.
 */

export const TABELA = "auditoria_eventos";

/** Quantos eventos a tela carrega por vez ("Carregar mais" traz o próximo lote). */
export const POR_PAGINA = 30;

// Cores dos níveis: informação=azul, atenção=amarelo, crítico=vermelho.
const NIVEIS = {
  informacao: { label: "Informação", cor: "#2563EB", bg: "#EAF1FF", ponto: "#2563EB" },
  atencao: { label: "Atenção", cor: "#A16207", bg: "#FEF7DF", ponto: "#CA8A04" },
  critico: { label: "Crítico", cor: "#DC2626", bg: "#FEF2F2", ponto: "#DC2626" },
};

export function nivelInfo(valor) {
  return NIVEIS[valor] ?? { label: valor ?? "--", cor: "#64748B", bg: "#F1F5F9", ponto: "#94A3B8" };
}

const MODULOS = {
  saldos: "Saldos",
  fornecedores: "Fornecedores",
  pagamentos: "Pagamentos",
  tributario: "Tributário",
  relatorios: "Relatórios",
  auditoria: "Auditoria",
  administracao: "Administração",
  usuarios: "Usuários",
  tarefas: "Tarefas",
  acesso: "Acesso",
};

export function moduloLabel(valor) {
  return MODULOS[valor] ?? valor ?? "--";
}

const ACOES = {
  criou: "Criou",
  alterou: "Alterou",
  excluiu: "Excluiu",
  aprovou: "Aprovou",
  rejeitou: "Rejeitou",
  login: "Entrou no sistema",
  logout: "Saiu do sistema",
};

export function acaoLabel(valor) {
  return ACOES[valor] ?? valor ?? "--";
}

export function resultadoLabel(valor) {
  if (valor === "falha") return "Falha";
  return "Sucesso";
}

export function formatarDataHora(valor) {
  if (!valor) return "--";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "--";
  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Id do usuário logado em public.usuarios.
 *
 * As telas de cadastro não recebem esse id por props; para não mudar o
 * comportamento visual delas, a trilha descobre o usuário por conta própria e
 * guarda o resultado por sessão (a política de insert exige que o usuario_id
 * seja exatamente o da sessão). Sair do sistema recarrega a página, então o
 * cache nunca sobrevive a uma troca de usuário.
 */
let usuarioEmCache = null;

async function usuarioAtualId() {
  if (usuarioEmCache) return usuarioEmCache;

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return null;

  const { data, error } = await supabase
    .from("usuarios")
    .select("id")
    .eq("auth_id", auth.user.id)
    .limit(1);
  if (error) return null;

  usuarioEmCache = data?.[0]?.id ?? null;
  return usuarioEmCache;
}

/**
 * Grava um evento na trilha de auditoria.
 *
 * @param modulo           'saldos' | 'fornecedores' | 'usuarios' | 'pagamentos' | 'tarefas' | ...
 * @param acao             'criou' | 'alterou' | 'excluiu' | 'aprovou' | 'rejeitou' | 'login' | 'logout'
 * @param registroAfetado  descrição do registro, ex: "Fornecedor XYZ LTDA"
 * @param valorAnterior    jsonb com o estado antes (opcional)
 * @param valorNovo        jsonb com o estado depois (opcional)
 * @param resultado        'sucesso' (padrão) ou 'falha'
 * @param nivel            'informacao' (padrão), 'atencao' ou 'critico'
 * @param usuarioId        id em public.usuarios; quando omitido, é descoberto aqui
 *
 * @returns null quando registrou; mensagem pronta para exibição quando falhou.
 */
export async function registrarEvento({
  modulo,
  acao,
  registroAfetado = null,
  valorAnterior = null,
  valorNovo = null,
  resultado = "sucesso",
  nivel = "informacao",
  usuarioId = null,
}) {
  try {
    const autor = usuarioId ?? (await usuarioAtualId());
    if (!autor) return "Esta ação não pôde ser registrada na auditoria do sistema.";

    const { error } = await supabase.from(TABELA).insert({
      usuario_id: autor,
      modulo,
      acao,
      registro_afetado: registroAfetado,
      valor_anterior: valorAnterior,
      valor_novo: valorNovo,
      resultado,
      nivel,
    });
    if (error) throw error;
    return null;
  } catch (e) {
    return mensagemAmigavel(e, "Esta ação não pôde ser registrada na auditoria do sistema.");
  }
}

/**
 * Lote de eventos mais recentes para a tela de consulta.
 *
 * @param pagina índice do lote, começando em 0
 * @returns { eventos, temMais }
 */
export async function listarEventos({ pagina = 0, porPagina = POR_PAGINA } = {}) {
  const inicio = pagina * porPagina;
  // Pede um a mais que o lote para saber se ainda existe algo depois dele.
  const fim = inicio + porPagina;

  const { data, error } = await supabase
    .from(TABELA)
    .select(
      "id, data_hora, modulo, acao, registro_afetado, valor_anterior, valor_novo, resultado, nivel, usuarios ( id, nome_completo )",
    )
    .order("data_hora", { ascending: false })
    .range(inicio, fim);
  if (error) throw error;

  const lote = data ?? [];
  return { eventos: lote.slice(0, porPagina), temMais: lote.length > porPagina };
}

/** Nome de quem fez a ação, já com o texto de apoio para eventos sem autor. */
export function nomeDoAutor(evento) {
  return evento?.usuarios?.nome_completo || "Usuário não identificado";
}
