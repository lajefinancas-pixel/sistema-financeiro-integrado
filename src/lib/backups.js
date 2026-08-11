import { supabase } from "./supabaseClient";
import { erroAmigavel, mensagemAmigavel } from "./erros";

/**
 * Camada de dados da categoria BACKUP da tela de Configurações
 * (tabela public.backups_log, criada pela migration
 * 20260811160000_notificacoes_preferencias_e_backups.sql).
 *
 * O que esta aplicação sabe sobre backup, ela sabe por registro: o backup
 * automático do banco é feito pela infraestrutura do Supabase, fora daqui.
 * Por isso a tabela começa vazia e a tela diz "nenhum registro" enquanto assim
 * estiver — nenhum número de exemplo é exibido como se fosse real.
 *
 * O que a aplicação realmente grava aqui é a SOLICITAÇÃO de restauração feita
 * na tela, com justificativa. A restauração em si não é executada por uma
 * aplicação web: o registro existe para que o pedido fique documentado.
 *
 * A tabela é somente-inserção e somente-leitura: nenhuma tela altera ou apaga
 * um registro.
 */

export const TABELA = "backups_log";

/** Quantos registros o histórico carrega de uma vez. */
export const LIMITE_HISTORICO = 50;

/** Justificativa mínima aceita em uma solicitação de restauração. */
export const MINIMO_JUSTIFICATIVA = 20;

const TIPOS = {
  backup: { label: "Backup", cor: "#0F2A44", bg: "#EEF2F6" },
  restauracao: { label: "Restauração", cor: "#B91C1C", bg: "#FEF2F2" },
};

const STATUS = {
  concluido: { label: "Concluído", cor: "#15803D", bg: "#EAFBF0" },
  registrado: { label: "Registrado", cor: "#A16207", bg: "#FEF7DF" },
  falha: { label: "Falha", cor: "#DC2626", bg: "#FEF2F2" },
};

export function tipoInfo(valor) {
  return TIPOS[valor] ?? { label: valor ?? "--", cor: "#64748B", bg: "#F1F5F9" };
}

export function statusInfo(valor) {
  return STATUS[valor] ?? { label: valor ?? "--", cor: "#64748B", bg: "#F1F5F9" };
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
 * A tabela ainda não existe no banco? (migration não aplicada)
 *
 * 42P01 é o "relation does not exist" do Postgres; PGRST205 é a mesma situação
 * vista pelo PostgREST, que não encontra a tabela no schema publicado.
 */
function tabelaAusente(erro) {
  return erro?.code === "42P01" || erro?.code === "PGRST205";
}

const COLUNAS = "id, tipo, status, descricao, justificativa, criado_em, usuarios ( id, nome_completo )";

/**
 * Panorama da área de backups.
 *
 * As contagens são feitas no banco (count exato, sem trazer as linhas) para que
 * o número mostrado seja o número real de registros, e não o tamanho da última
 * página consultada.
 *
 * @returns {
 *   disponivel,      // false quando a tabela de registros ainda não existe no banco
 *   ultimoBackup,    // registro de backup mais recente, ou null
 *   totalBackups,    // quantos registros de backup existem
 *   totalRestauracoes,
 * }
 */
export async function resumoBackups() {
  const vazio = { disponivel: false, ultimoBackup: null, totalBackups: 0, totalRestauracoes: 0 };

  const { data, error } = await supabase
    .from(TABELA)
    .select(COLUNAS)
    .eq("tipo", "backup")
    .order("criado_em", { ascending: false })
    .limit(1);

  if (error) {
    if (tabelaAusente(error)) return vazio;
    throw erroAmigavel(mensagemAmigavel(error, "Não foi possível consultar os registros de backup."));
  }

  async function contar(tipo) {
    const { count, error: erroContagem } = await supabase
      .from(TABELA)
      .select("id", { count: "exact", head: true })
      .eq("tipo", tipo);
    if (erroContagem) throw erroContagem;
    return count ?? 0;
  }

  try {
    const [totalBackups, totalRestauracoes] = await Promise.all([
      contar("backup"),
      contar("restauracao"),
    ]);
    return { disponivel: true, ultimoBackup: data?.[0] ?? null, totalBackups, totalRestauracoes };
  } catch (e) {
    if (tabelaAusente(e)) return vazio;
    throw erroAmigavel(mensagemAmigavel(e, "Não foi possível consultar os registros de backup."));
  }
}

/** Histórico completo (backups e solicitações de restauração), do mais recente ao mais antigo. */
export async function listarRegistros({ limite = LIMITE_HISTORICO } = {}) {
  const { data, error } = await supabase
    .from(TABELA)
    .select(COLUNAS)
    .order("criado_em", { ascending: false })
    .limit(limite);

  if (error) {
    if (tabelaAusente(error)) return { disponivel: false, registros: [] };
    throw erroAmigavel(mensagemAmigavel(error, "Não foi possível carregar o histórico de backups."));
  }

  return { disponivel: true, registros: data ?? [] };
}

/** Nome de quem registrou, com o texto de apoio para registros sem autor. */
export function nomeDoAutor(registro) {
  return registro?.usuarios?.nome_completo || "Usuário não identificado";
}

/** A justificativa informada é aceitável? Devolve o texto limpo ou lança. */
export function justificativaValida(texto) {
  const justificativa = String(texto ?? "").trim().replace(/\s+/g, " ");
  if (justificativa.length < MINIMO_JUSTIFICATIVA) {
    throw erroAmigavel(
      `Descreva o motivo da restauração com pelo menos ${MINIMO_JUSTIFICATIVA} caracteres. A justificativa fica registrada na Auditoria.`
    );
  }
  return justificativa;
}

/**
 * Registra a solicitação de restauração no histórico de backups.
 *
 * Nada é restaurado aqui: a restauração de um banco é feita na infraestrutura,
 * fora da aplicação. Este registro é o documento do pedido — e acompanha o
 * evento crítico gravado na trilha de auditoria pela própria tela.
 *
 * @returns null quando registrou; mensagem pronta para exibição quando falhou.
 */
export async function registrarSolicitacaoRestauracao({ justificativa, usuarioId }) {
  if (!usuarioId) return "A solicitação não pôde ser registrada no histórico de backups.";

  const { error } = await supabase.from(TABELA).insert({
    tipo: "restauracao",
    status: "registrado",
    descricao: "Solicitação de restauração registrada pela tela de Configurações",
    justificativa,
    usuario_id: usuarioId,
  });

  if (!error) return null;
  if (tabelaAusente(error)) {
    return "O histórico de backups ainda não existe no banco, então a solicitação foi registrada apenas na Auditoria.";
  }
  return mensagemAmigavel(error, "A solicitação não pôde ser registrada no histórico de backups.");
}
