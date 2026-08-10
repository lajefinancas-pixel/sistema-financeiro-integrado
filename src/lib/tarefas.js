import { supabase } from "./supabaseClient";

/**
 * Camada de dados da página "Tarefas".
 *
 * Tabelas usadas:
 *   tarefas            -> a tarefa em si (responsável, prazo, prioridade, status...)
 *   tarefas_historico  -> trilha do que aconteceu com cada tarefa (coluna "detalhes" é jsonb)
 *   usuarios           -> nome do responsável e de quem criou
 *   secretarias        -> opções do campo "Secretaria relacionada" (gravado como texto)
 *
 * O status "atrasada" não é gravado: ele é derivado do prazo (prazo anterior a hoje
 * em tarefas que não estão concluídas nem canceladas).
 */

export const MODULO = "tarefas";

export const STATUS = {
  nova: { label: "Nova", cor: "#475569", bg: "#F1F5F9", ponto: "#94A3B8" },
  recebida: { label: "Recebida", cor: "#2563EB", bg: "#EAF1FF", ponto: "#2563EB" },
  em_andamento: { label: "Em andamento", cor: "#8A6100", bg: "#FEF6DF", ponto: "#EAB308" },
  aguardando_resposta: { label: "Aguardando resposta", cor: "#7C3AED", bg: "#F3EDFF", ponto: "#7C3AED" },
  em_analise: { label: "Em análise", cor: "#C2410C", bg: "#FFF1E6", ponto: "#F97316" },
  concluida: { label: "Concluída", cor: "#15803D", bg: "#EAFBF0", ponto: "#16A34A" },
  atrasada: { label: "Atrasada", cor: "#DC2626", bg: "#FEF2F2", ponto: "#DC2626" },
  cancelada: { label: "Cancelada", cor: "#334155", bg: "#E2E8F0", ponto: "#334155" },
};

export const PRIORIDADES = {
  baixa: { label: "Baixa", cor: "#475569", bg: "#F1F5F9" },
  normal: { label: "Normal", cor: "#2563EB", bg: "#EAF1FF" },
  alta: { label: "Alta", cor: "#B45309", bg: "#FEF3E2" },
  urgente: { label: "Urgente", cor: "#DC2626", bg: "#FEF2F2" },
};

export const CATEGORIAS = [
  { id: "financeiro", label: "Financeiro" },
  { id: "pagamento", label: "Pagamento" },
  { id: "fornecedor", label: "Fornecedor" },
  { id: "tributario", label: "Tributário" },
  { id: "relatorio", label: "Relatório" },
  { id: "documento", label: "Documento" },
  { id: "conferencia", label: "Conferência" },
  { id: "banco", label: "Banco" },
  { id: "administrativo", label: "Administrativo" },
  { id: "outro", label: "Outro" },
];

export function statusInfo(chave) {
  return STATUS[chave] ?? { label: chave ?? "--", cor: "#475569", bg: "#F1F5F9", ponto: "#94A3B8" };
}

export function prioridadeInfo(chave) {
  return PRIORIDADES[chave] ?? { label: chave ?? "--", cor: "#475569", bg: "#F1F5F9" };
}

export function categoriaLabel(chave) {
  return CATEGORIAS.find((c) => c.id === chave)?.label ?? (chave || "--");
}

/** Data de hoje no formato aceito pela coluna "prazo" (date), no fuso local. */
export function hojeISO() {
  const agora = new Date();
  const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

const STATUS_ENCERRADOS = ["concluida", "cancelada"];

/** Prazo já vencido em tarefa que continua aberta. */
export function estaAtrasada(tarefa) {
  if (!tarefa?.prazo) return false;
  if (STATUS_ENCERRADOS.includes(tarefa.status)) return false;
  return tarefa.prazo < hojeISO();
}

/** Status mostrado na tela: "atrasada" tem prioridade sobre o status gravado. */
export function statusVisual(tarefa) {
  if (estaAtrasada(tarefa)) return "atrasada";
  return tarefa?.status ?? "nova";
}

export function formatarData(valor) {
  if (!valor) return "--";
  const [ano, mes, dia] = String(valor).slice(0, 10).split("-");
  if (!ano || !mes || !dia) return "--";
  return `${dia}/${mes}/${ano}`;
}

export function formatarHora(valor) {
  if (!valor) return null;
  return String(valor).slice(0, 5);
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

/** "Vence em 3 dias", "Venceu há 2 dias", "Vence hoje" -- texto de apoio do prazo. */
export function textoPrazo(tarefa) {
  if (!tarefa?.prazo) return null;
  const hoje = hojeISO();
  const dias = Math.round((new Date(`${tarefa.prazo}T00:00:00`) - new Date(`${hoje}T00:00:00`)) / 86400000);
  if (STATUS_ENCERRADOS.includes(tarefa.status)) return null;
  if (dias === 0) return "Vence hoje";
  if (dias === 1) return "Vence amanhã";
  if (dias > 1) return `Vence em ${dias} dias`;
  if (dias === -1) return "Venceu ontem";
  return `Venceu há ${Math.abs(dias)} dias`;
}

const COLUNAS_TAREFA = `
  id, titulo, descricao, status, prioridade, categoria, prazo, horario_limite,
  secretaria_relacionada, responsavel_id, criado_por, criado_em, concluida_em,
  responsavel:usuarios!tarefas_responsavel_id_fkey ( id, nome_completo ),
  autor:usuarios!tarefas_criado_por_fkey ( id, nome_completo )
`;

/** Tarefas ordenadas por prazo (mais próximo primeiro; sem prazo por último). */
export async function listarTarefas() {
  const { data, error } = await supabase
    .from("tarefas")
    .select(COLUNAS_TAREFA)
    .order("prazo", { ascending: true, nullsFirst: false })
    .order("criado_em", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listarUsuarios() {
  const { data, error } = await supabase
    .from("usuarios")
    .select("id, nome_completo, cargo, status")
    .order("nome_completo", { ascending: true });
  if (error) throw error;
  return (data ?? []).filter((u) => u.status !== "inativo");
}

export async function listarSecretarias() {
  const { data, error } = await supabase
    .from("secretarias")
    .select("id, nome")
    .eq("ativo", true)
    .order("nome", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Cria a tarefa com status inicial "nova" e registra a linha de histórico
 * correspondente (acao: "criou"). A falha do histórico não desfaz a tarefa:
 * ela volta como aviso para a tela decidir o que mostrar.
 */
export async function criarTarefa(campos, usuarioId) {
  const registro = {
    titulo: campos.titulo.trim(),
    descricao: campos.descricao?.trim() || null,
    responsavel_id: campos.responsavel_id || null,
    prazo: campos.prazo || null,
    horario_limite: campos.horario_limite || null,
    prioridade: campos.prioridade || "normal",
    categoria: campos.categoria || null,
    secretaria_relacionada: campos.secretaria_relacionada || null,
    status: "nova",
    criado_por: usuarioId,
  };

  const { data, error } = await supabase.from("tarefas").insert(registro).select(COLUNAS_TAREFA).single();
  if (error) throw error;

  const { error: erroHistorico } = await supabase.from("tarefas_historico").insert({
    tarefa_id: data.id,
    usuario_id: usuarioId,
    acao: "criou",
    detalhes: {
      titulo: data.titulo,
      status: data.status,
      prioridade: data.prioridade,
      prazo: data.prazo,
      responsavel_id: data.responsavel_id,
    },
  });

  return { tarefa: data, avisoHistorico: erroHistorico?.message ?? null };
}
