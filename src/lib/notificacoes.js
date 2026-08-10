import { supabase } from "./supabaseClient";
import { mensagemAmigavel } from "./erros";

/**
 * Camada de dados das notificações (tabela "notificacoes").
 *
 * Colunas usadas: id, usuario_id, tarefa_id, tipo, mensagem, lida, criado_em.
 *
 * Notificar é sempre um efeito secundário: nenhuma falha aqui pode derrubar a
 * ação principal (criar tarefa, comentar, devolver...). Por isso as funções de
 * gravação devolvem a mensagem de erro em vez de lançá-la — quem chamou decide
 * se mostra um aviso na tela.
 */

const COLUNAS = "id, usuario_id, tarefa_id, tipo, mensagem, lida, criado_em";

export const TIPOS = {
  tarefa_atribuida: { label: "Tarefa atribuída", cor: "#2563EB" },
  tarefa_compartilhada: { label: "Tarefa compartilhada", cor: "#7C3AED" },
  tarefa_vence_hoje: { label: "Vence hoje", cor: "#B45309" },
  tarefa_atrasada: { label: "Tarefa atrasada", cor: "#DC2626" },
  tarefa_comentario: { label: "Novo comentário", cor: "#0F2A44" },
  tarefa_devolvida: { label: "Devolvida para correção", cor: "#DC2626" },
  tarefa_aprovada: { label: "Tarefa aprovada", cor: "#15803D" },
  tarefa_aguardando_aprovacao: { label: "Aguardando aprovação", cor: "#C2410C" },
};

export function tipoInfo(chave) {
  return TIPOS[chave] ?? { label: "Notificação", cor: "#475569" };
}

export async function listarNotificacoes(usuarioId, { apenasNaoLidas = false, limite = 40 } = {}) {
  if (!usuarioId) return [];
  let consulta = supabase
    .from("notificacoes")
    .select(COLUNAS)
    .eq("usuario_id", usuarioId)
    .order("criado_em", { ascending: false })
    .limit(limite);
  if (apenasNaoLidas) consulta = consulta.eq("lida", false);

  const { data, error } = await consulta;
  if (error) throw error;
  return data ?? [];
}

export async function marcarComoLida(notificacaoId) {
  const { error } = await supabase.from("notificacoes").update({ lida: true }).eq("id", notificacaoId);
  if (error) throw error;
}

export async function marcarTodasComoLidas(usuarioId) {
  if (!usuarioId) return;
  const { error } = await supabase
    .from("notificacoes")
    .update({ lida: true })
    .eq("usuario_id", usuarioId)
    .eq("lida", false);
  if (error) throw error;
}

/**
 * Grava as notificações informadas. Linhas sem destinatário são descartadas e
 * um mesmo destinatário não recebe a mesma linha duas vezes na chamada.
 * Devolve a mensagem de erro (ou null quando tudo foi gravado).
 */
export async function notificar(linhas) {
  const vistos = new Set();
  const registros = (Array.isArray(linhas) ? linhas : [linhas])
    .filter((linha) => linha?.usuario_id && linha?.tipo && linha?.mensagem)
    .filter((linha) => {
      const chave = `${linha.usuario_id}|${linha.tipo}|${linha.tarefa_id ?? ""}`;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    })
    .map((linha) => ({
      usuario_id: linha.usuario_id,
      tarefa_id: linha.tarefa_id ?? null,
      tipo: linha.tipo,
      mensagem: linha.mensagem,
      lida: false,
    }));

  if (registros.length === 0) return null;

  const { error } = await supabase.from("notificacoes").insert(registros);
  return error ? mensagemAmigavel(error, "Alguns avisos da equipe não foram gerados agora.") : null;
}

/** Início do dia de hoje no fuso local, no formato aceito pelo filtro de criado_em. */
function inicioDeHoje() {
  const agora = new Date();
  agora.setHours(0, 0, 0, 0);
  return agora.toISOString();
}

/**
 * Cria as notificações de prazo das tarefas de quem está logado: "vence hoje"
 * para o prazo do dia e "atrasada" para o prazo já vencido.
 *
 * A varredura roda quando a página abre. Para não repetir o mesmo aviso a cada
 * carregamento, só entram as tarefas que ainda não geraram aquele tipo de
 * notificação hoje — ou seja, no máximo um aviso por tarefa por dia.
 */
export async function sincronizarNotificacoesDePrazo(usuarioId, tarefas, hoje) {
  if (!usuarioId || !hoje) return null;

  const encerradas = ["concluida", "cancelada"];
  const pendentes = (tarefas ?? []).filter(
    (t) => t.responsavel_id === usuarioId && t.prazo && !encerradas.includes(t.status),
  );
  const doDia = pendentes.filter((t) => t.prazo === hoje);
  const vencidas = pendentes.filter((t) => t.prazo < hoje);
  if (doDia.length === 0 && vencidas.length === 0) return null;

  const { data, error } = await supabase
    .from("notificacoes")
    .select("tarefa_id, tipo")
    .eq("usuario_id", usuarioId)
    .gte("criado_em", inicioDeHoje());
  if (error) return mensagemAmigavel(error, "Não foi possível verificar os avisos de prazo agora.");

  const jaAvisado = new Set((data ?? []).map((n) => `${n.tarefa_id}|${n.tipo}`));
  const novas = [];

  doDia.forEach((t) => {
    if (jaAvisado.has(`${t.id}|tarefa_vence_hoje`)) return;
    novas.push({
      usuario_id: usuarioId,
      tarefa_id: t.id,
      tipo: "tarefa_vence_hoje",
      mensagem: `A tarefa "${t.titulo}" vence hoje.`,
    });
  });

  vencidas.forEach((t) => {
    if (jaAvisado.has(`${t.id}|tarefa_atrasada`)) return;
    novas.push({
      usuario_id: usuarioId,
      tarefa_id: t.id,
      tipo: "tarefa_atrasada",
      mensagem: `A tarefa "${t.titulo}" está atrasada.`,
    });
  });

  return notificar(novas);
}
